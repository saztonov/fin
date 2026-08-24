import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { loadConfig } from '../config.js';
import { createDb, type Db } from '../db/client.js';
import { ApiError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { authPlugin } from './plugins/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { exportRoutes } from './routes/exports.js';
import { importRoutes } from './routes/imports.js';
import { ks2Routes } from './routes/ks2.js';
import { ks6Routes } from './routes/ks6.js';
import { objectRoutes } from './routes/objects.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export async function buildServer() {
  const cfg = loadConfig();
  const logger = createLogger('api');
  const { db, pool } = createDb();

  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  app.decorate('db', db);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: cfg.UPLOAD_MAX_BYTES, files: 1 },
  });
  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const detail = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply
        .status(400)
        .send({ error: { code: 'validation', message: `Некорректные данные: ${detail}` } });
    }
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode < 500) {
      const code = (err as { code?: string }).code ?? 'request_error';
      return reply
        .status(statusCode)
        .send({ error: { code, message: (err as Error).message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'Внутренняя ошибка сервера' } });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'db_unavailable' });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(objectRoutes);
      await api.register(ks6Routes);
      await api.register(ks2Routes);
      await api.register(importRoutes);
      await api.register(exportRoutes);
      await api.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
