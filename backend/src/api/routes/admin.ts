import { hash } from '@node-rs/argon2';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  constructionObjects,
  userObjectAssignments,
  users,
} from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { revokeAllSessions } from '../../services/auth.service.js';
import { ApiError } from '../../lib/errors.js';

const idParam = z.object({ id: z.string().uuid() });

const createUserSchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().trim().min(3).max(200),
  position: z.string().trim().max(200).default(''),
  role: z.enum(['admin', 'manager', 'economist']).default('economist'),
  password: z.string().min(8).max(128),
  isActive: z.boolean().default(true),
});

const patchUserSchema = z.object({
  fullName: z.string().trim().min(3).max(200).optional(),
  position: z.string().trim().max(200).optional(),
  role: z.enum(['admin', 'manager', 'economist']).optional(),
  isActive: z.boolean().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireRole('admin'));

  app.get('/users', async () => {
    const rows = await app.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        position: users.position,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.createdAt));
    const assignments = await app.db
      .select({
        userId: userObjectAssignments.userId,
        objectId: userObjectAssignments.objectId,
        code: constructionObjects.code,
        name: constructionObjects.name,
      })
      .from(userObjectAssignments)
      .innerJoin(
        constructionObjects,
        eq(constructionObjects.id, userObjectAssignments.objectId),
      );
    return rows.map((u) => ({
      ...u,
      objects: assignments
        .filter((a) => a.userId === u.id)
        .map((a) => ({ id: a.objectId, code: a.code, name: a.name })),
    }));
  });

  app.post('/users', async (req, reply) => {
    const input = createUserSchema.parse(req.body);
    const dup = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
    if (dup.length > 0) throw ApiError.conflict('Почта уже занята', 'email_taken');
    const [created] = await app.db
      .insert(users)
      .values({
        email: input.email,
        fullName: input.fullName,
        position: input.position,
        role: input.role,
        isActive: input.isActive,
        passwordHash: await hash(input.password),
      })
      .returning({ id: users.id });
    await writeAudit(app.db, {
      action: 'user.create',
      userId: req.authUser.id,
      entityType: 'user',
      entityId: created?.id,
      details: { email: input.email, role: input.role },
    });
    return reply.status(201).send({ id: created?.id });
  });

  app.patch('/users/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const input = patchUserSchema.parse(req.body);
    const [existing] = await app.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!existing) throw ApiError.notFound('Пользователь не найден');
    const [updated] = await app.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        position: users.position,
        role: users.role,
        isActive: users.isActive,
      });
    if (input.role && input.role !== existing.role) {
      await writeAudit(app.db, {
        action: 'user.role_change',
        userId: req.authUser.id,
        entityType: 'user',
        entityId: id,
        details: { from: existing.role, to: input.role },
      });
    }
    if (input.isActive === true && !existing.isActive) {
      await writeAudit(app.db, {
        action: 'user.activate',
        userId: req.authUser.id,
        entityType: 'user',
        entityId: id,
      });
    }
    return updated;
  });

  app.put('/users/:id/objects', async (req) => {
    const { id } = idParam.parse(req.params);
    const { objectIds } = z
      .object({ objectIds: z.array(z.string().uuid()).max(500) })
      .parse(req.body);
    const [user] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!user) throw ApiError.notFound('Пользователь не найден');
    if (objectIds.length > 0) {
      const found = await app.db
        .select({ id: constructionObjects.id })
        .from(constructionObjects)
        .where(
          and(inArray(constructionObjects.id, objectIds), isNull(constructionObjects.deletedAt)),
        );
      if (found.length !== objectIds.length) {
        throw ApiError.badRequest('Некоторые объекты не найдены', 'bad_objects');
      }
    }
    await app.db.transaction(async (tx) => {
      await tx.delete(userObjectAssignments).where(eq(userObjectAssignments.userId, id));
      if (objectIds.length > 0) {
        await tx
          .insert(userObjectAssignments)
          .values(objectIds.map((objectId) => ({ userId: id, objectId })));
      }
    });
    await writeAudit(app.db, {
      action: 'user.objects_change',
      userId: req.authUser.id,
      entityType: 'user',
      entityId: id,
      details: { objectIds },
    });
    return { message: 'Назначения обновлены' };
  });

  app.post('/users/:id/set-password', async (req) => {
    const { id } = idParam.parse(req.params);
    const { password } = z.object({ password: z.string().min(8).max(128) }).parse(req.body);
    const [updated] = await app.db
      .update(users)
      .set({ passwordHash: await hash(password), updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!updated) throw ApiError.notFound('Пользователь не найден');
    // сброс пароля гасит все действующие сессии пользователя
    await revokeAllSessions(app.db, id);
    await writeAudit(app.db, {
      action: 'user.password_reset',
      userId: req.authUser.id,
      entityType: 'user',
      entityId: id,
    });
    return { message: 'Пароль установлен' };
  });
}
