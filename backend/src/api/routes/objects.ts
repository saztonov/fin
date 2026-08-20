import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { constructionObjects, userObjectAssignments } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';

const objectSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'Код объекта — ровно 5 цифр'),
  name: z.string().trim().min(1, 'Укажите название').max(500),
  address: z.string().trim().max(1000).default(''),
});

const idParam = z.object({ id: z.string().uuid() });

export async function objectRoutes(app: FastifyInstance) {
  app.get('/objects', { preHandler: [app.authenticate] }, async (req) => {
    const base = and(isNull(constructionObjects.deletedAt));
    if (req.authUser.role === 'economist') {
      const assigned = await app.db
        .select({ objectId: userObjectAssignments.objectId })
        .from(userObjectAssignments)
        .where(eq(userObjectAssignments.userId, req.authUser.id));
      // назначений нет — видны все (требование заказчика)
      if (assigned.length > 0) {
        return app.db
          .select()
          .from(constructionObjects)
          .where(
            and(
              base,
              inArray(
                constructionObjects.id,
                assigned.map((a) => a.objectId),
              ),
            ),
          )
          .orderBy(asc(constructionObjects.code));
      }
    }
    return app.db
      .select()
      .from(constructionObjects)
      .where(base)
      .orderBy(asc(constructionObjects.code));
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
