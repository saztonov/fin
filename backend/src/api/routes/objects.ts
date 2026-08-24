import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { constructionObjects, userObjectAssignments } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';
import { getObjectSummaries } from '../../services/object-summary.service.js';

const objectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Укажите код объекта')
    .max(5, 'Код объекта — не более 5 символов'),
  name: z.string().trim().min(1, 'Укажите название').max(500),
  address: z.string().trim().max(1000).default(''),
});

const idParam = z.object({ id: z.string().uuid() });

/**
 * Область видимости объектов: null — ограничений нет, иначе список id.
 * Экономист без назначений видит все объекты (требование заказчика).
 */
async function visibleObjectIds(
  app: FastifyInstance,
  user: { id: string; role: string },
): Promise<string[] | null> {
  if (user.role !== 'economist') return null;
  const assigned = await app.db
    .select({ objectId: userObjectAssignments.objectId })
    .from(userObjectAssignments)
    .where(eq(userObjectAssignments.userId, user.id));
  return assigned.length > 0 ? assigned.map((a) => a.objectId) : null;
}

export async function objectRoutes(app: FastifyInstance) {
  app.get('/objects', { preHandler: [app.authenticate] }, async (req) => {
    const base = isNull(constructionObjects.deletedAt);
    const ids = await visibleObjectIds(app, req.authUser);
    return app.db
      .select()
      .from(constructionObjects)
      .where(ids ? and(base, inArray(constructionObjects.id, ids)) : base)
      .orderBy(asc(constructionObjects.code));
  });

  /**
   * Сводка для карточек объектов на стартовом экране КС: сумма сметы,
   * выполнение и остаток. Регистрируется до `/objects/:id` — статический
   * сегмент должен читаться как таковой, а не как параметр.
   */
  app.get('/objects/summary', { preHandler: [app.authenticate] }, async (req) => {
    const ids = await visibleObjectIds(app, req.authUser);
    return getObjectSummaries(app.db, ids);
  });

  app.post(
    '/objects',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const input = objectSchema.parse(req.body);
      const dup = await app.db
        .select({ id: constructionObjects.id })
        .from(constructionObjects)
        .where(and(eq(constructionObjects.code, input.code), isNull(constructionObjects.deletedAt)));
      if (dup.length > 0) throw ApiError.conflict('Объект с таким кодом уже существует', 'code_taken');
      const [created] = await app.db.insert(constructionObjects).values(input).returning();
      await writeAudit(app.db, {
        action: 'object.create',
        userId: req.authUser.id,
        entityType: 'object',
        entityId: created?.id,
        details: input,
      });
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/objects/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const input = objectSchema.partial().parse(req.body);
      if (input.code) {
        const dup = await app.db
          .select({ id: constructionObjects.id })
          .from(constructionObjects)
          .where(and(eq(constructionObjects.code, input.code), isNull(constructionObjects.deletedAt)));
        if (dup.some((d) => d.id !== id)) {
          throw ApiError.conflict('Объект с таким кодом уже существует', 'code_taken');
        }
      }
      const [updated] = await app.db
        .update(constructionObjects)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(constructionObjects.id, id), isNull(constructionObjects.deletedAt)))
        .returning();
      if (!updated) throw ApiError.notFound('Объект не найден');
      await writeAudit(app.db, {
        action: 'object.update',
        userId: req.authUser.id,
        entityType: 'object',
        entityId: id,
        details: input,
      });
      return updated;
    },
  );

  app.delete(
    '/objects/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const [deleted] = await app.db
        .update(constructionObjects)
        .set({ deletedAt: new Date() })
        .where(and(eq(constructionObjects.id, id), isNull(constructionObjects.deletedAt)))
        .returning({ id: constructionObjects.id });
      if (!deleted) throw ApiError.notFound('Объект не найден');
      await writeAudit(app.db, {
        action: 'object.delete',
        userId: req.authUser.id,
        entityType: 'object',
        entityId: id,
      });
      return { message: 'Объект удалён' };
    },
  );
}
