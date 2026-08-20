import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { refreshTokens, users, type UserRole } from '../db/schema/index.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';

export interface AccessClaims {
  sub: string;
  role: UserRole;
  name: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; position: string; role: UserRole };
}

const secretKey = () => new TextEncoder().encode(loadConfig().JWT_SECRET);

function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

async function signAccess(user: { id: string; role: UserRole; fullName: string }): Promise<string> {
  const cfg = loadConfig();
  return new SignJWT({ role: user.role, name: user.fullName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('ks-portal')
    .setAudience('ks-api')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + cfg.ACCESS_TTL_SEC)
    .sign(secretKey());
}

export async function verifyAccess(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'ks-portal',
      audience: 'ks-api',
    });
    return {
      sub: payload.sub as string,
      role: payload.role as UserRole,
      name: (payload.name as string) ?? '',
    };
  } catch {
    throw ApiError.unauthorized('Токен недействителен или истёк', 'token_invalid');
  }
}

interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

async function issueRefresh(db: Db, userId: string, familyId: string, meta: ClientMeta) {
  const cfg = loadConfig();
  const raw = crypto.randomBytes(48).toString('base64url');
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(raw),
    familyId,
    expiresAt: new Date(Date.now() + cfg.REFRESH_TTL_SEC * 1000),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return raw;
}

export async function register(
  db: Db,
  input: { email: string; fullName: string; position: string; password: string },
  meta: ClientMeta,
): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
  if (existing.length > 0) {
    throw ApiError.conflict('Пользователь с такой почтой уже зарегистрирован', 'email_taken');
  }
  const [created] = await db
    .insert(users)
    .values({
      email: input.email,
      fullName: input.fullName,
      position: input.position,
      passwordHash: await hash(input.password),
      role: 'economist',
      isActive: false,
    })
    .returning({ id: users.id });
  await writeAudit(db, {
    action: 'user.register',
    entityType: 'user',
    entityId: created?.id,
    ip: meta.ip,
    details: { email: input.email },
  });
}

export async function login(
  db: Db,
  email: string,
  password: string,
  meta: ClientMeta,
): Promise<TokenPair> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));
  const ok = user ? await verify(user.passwordHash, password) : false;
  if (!user || !ok) {
    await writeAudit(db, { action: 'login.fail', ip: meta.ip, details: { email } });
    throw ApiError.unauthorized('Неверная почта или пароль', 'bad_credentials');
  }
  if (!user.isActive) {
    await writeAudit(db, { action: 'login.inactive', userId: user.id, ip: meta.ip });
    throw ApiError.forbidden(
      'Учётная запись ещё не активирована администратором',
      'user_inactive',
    );
  }
  const refreshToken = await issueRefresh(db, user.id, crypto.randomUUID(), meta);
  const accessToken = await signAccess(user);
  await writeAudit(db, { action: 'login.ok', userId: user.id, ip: meta.ip });
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      position: user.position,
      role: user.role,
    },
  };
}

/** Rotation + reuse detection (корпстандарт §13). */
export async function refresh(db: Db, rawToken: string, meta: ClientMeta): Promise<TokenPair> {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(rawToken)));
  if (!row) throw ApiError.unauthorized('Сессия не найдена', 'refresh_invalid');

  if (row.usedAt || row.revokedAt) {
    // повторное предъявление использованного токена — компрометация: гасим всё семейство
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    await writeAudit(db, {
      action: 'refresh.reuse',
      userId: row.userId,
      ip: meta.ip,
      details: { familyId: row.familyId },
    });
    throw ApiError.unauthorized('Сессия отозвана', 'refresh_reused');
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('Сессия истекла', 'refresh_expired');
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, row.userId), isNull(users.deletedAt)));
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Учётная запись недоступна', 'user_unavailable');
  }

  await db.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, row.id));
  const refreshToken = await issueRefresh(db, user.id, row.familyId, meta);
  const accessToken = await signAccess(user);
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      position: user.position,
      role: user.role,
    },
  };
}

export async function logout(db: Db, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, sha256(rawToken)));
}

/** Ревокация всех действующих refresh-сессий пользователя (смена/сброс пароля). */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw ApiError.notFound('Пользователь не найден');
  if (!(await verify(user.passwordHash, currentPassword))) {
    throw ApiError.badRequest('Текущий пароль указан неверно', 'bad_current_password');
  }
  await db
    .update(users)
    .set({ passwordHash: await hash(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
  // после смены пароля все сессии завершаются
  await revokeAllSessions(db, userId);
  await writeAudit(db, { action: 'password.change', userId });
}
