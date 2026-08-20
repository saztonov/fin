import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../../db/client.js';
import {
  constructionObjects,
  contracts,
  userObjectAssignments,
  type UserRole,
} from '../../db/schema/index.js';
import { ApiError } from '../../lib/errors.js';
import { verifyAccess } from '../../services/auth.service.js';

export interface AuthUser {
  id: string;
  role: UserRole;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (req: FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('authUser', null as unknown as AuthUser);

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized();
    }
    const claims = await verifyAccess(header.slice('Bearer '.length));
    req.authUser = { id: claims.sub, role: claims.role, name: claims.name };
  });

  app.decorate('requireRole', (...roles: UserRole[]) => {
    return async (req: FastifyRequest) => {
      if (!roles.includes(req.authUser.role)) {
        throw ApiError.forbidden();
      }
    };
  });
});

/**
 * Бизнес-доступ к объекту строительства: manager/admin видят всё,
 * economist — назначенные объекты; если назначений нет — видны все
 * (требование заказчика).
 */
export async function assertObjectAccess(
  db: Db,
  user: AuthUser,
  objectId: string,
): Promise<void> {
  if (user.role !== 'economist') return;
  const assigned = await db
    .select({ objectId: userObjectAssignments.objectId })
    .from(userObjectAssignments)
    .where(eq(userObjectAssignments.userId, user.id));
  if (assigned.length === 0) return;
  if (!assigned.some((a) => a.objectId === objectId)) {
    throw ApiError.forbidden('Объект не назначен пользователю', 'object_not_assigned');
  }
}

/** Доступ к объекту через договор (для маршрутов /contracts/:id, /ks2/:id и т.п.). */
export async function assertContractAccess(
  db: Db,
  user: AuthUser,
  contractId: string,
): Promise<{ contractId: string; objectId: string }> {
  const [row] = await db
    .select({ id: contracts.id, objectId: contracts.objectId })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), isNull(contracts.deletedAt)));
  if (!row) throw ApiError.notFound('Договор не найден');
  await assertObjectAccess(db, user, row.objectId);
  return { contractId: row.id, objectId: row.objectId };
}

/** Проверка существования объекта (+доступа). */
export async function assertObjectExists(
  db: Db,
  user: AuthUser,
  objectId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: constructionObjects.id })
    .from(constructionObjects)
    .where(and(eq(constructionObjects.id, objectId), isNull(constructionObjects.deletedAt)));
  if (!row) throw ApiError.notFound('Объект не найден');
  await assertObjectAccess(db, user, objectId);
}
