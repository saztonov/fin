import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadConfig } from '../../config.js';
import { constructionObjects, userObjectAssignments, users } from '../../db/schema/index.js';
import { ApiError } from '../../lib/errors.js';
import * as auth from '../../services/auth.service.js';

const REFRESH_COOKIE = 'ks_refresh';

const registerSchema = z.object({
  email: z.string().email('Некорректный адрес почты').max(320),
  fullName: z.string().trim().min(3, 'Укажите ФИО').max(200),
  position: z.string().trim().max(200).default(''),
  password: z.string().min(8, 'Пароль не короче 8 символов').max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8, 'Пароль не короче 8 символов').max(128),
});

function setRefreshCookie(reply: FastifyReply, token: string) {
  const cfg = loadConfig();
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cfg.NODE_ENV === 'production',
    path: '/api/v1/auth',
    maxAge: cfg.REFRESH_TTL_SEC,
  });
}

function clientMeta(req: FastifyRequest) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

/** CSRF-дисциплина для cookie-эндпоинтов: кастомный заголовок обязателен. */
function assertCsrfHeader(req: FastifyRequest) {
  if (req.headers['x-requested-with'] !== 'ks-portal') {
    throw ApiError.forbidden('Отсутствует CSRF-заголовок', 'csrf');
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = registerSchema.parse(req.body);
    await auth.register(app.db, input, clientMeta(req));
    return reply.status(201).send({
      message: 'Заявка принята. Учётная запись станет доступна после активации администратором.',
    });
  });

  app.post('/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = loginSchema.parse(req.body);
    const pair = await auth.login(app.db, input.email, input.password, clientMeta(req));
    setRefreshCookie(reply, pair.refreshToken);
    return { accessToken: pair.accessToken, user: pair.user };
  });

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    assertCsrfHeader(req);
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw ApiError.unauthorized('Нет сессии', 'no_refresh');
    const pair = await auth.refresh(app.db, raw, clientMeta(req));
    setRefreshCookie(reply, pair.refreshToken);
    return { accessToken: pair.accessToken, user: pair.user };
  });

  app.post('/logout', async (req, reply) => {
    assertCsrfHeader(req);
    await auth.logout(app.db, req.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { message: 'Выход выполнен' };
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const [user] = await app.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        position: users.position,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, req.authUser.id));
    if (!user) throw ApiError.unauthorized();
    const assigned = await app.db
      .select({ id: constructionObjects.id, code: constructionObjects.code, name: constructionObjects.name })
      .from(userObjectAssignments)
      .innerJoin(constructionObjects, eq(constructionObjects.id, userObjectAssignments.objectId))
      .where(eq(userObjectAssignments.userId, user.id));
    return { user, assignedObjects: assigned };
  });

  app.post('/change-password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const input = changePasswordSchema.parse(req.body);
    await auth.changePassword(app.db, req.authUser.id, input.currentPassword, input.newPassword);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { message: 'Пароль изменён. Войдите заново.' };
  });
}
