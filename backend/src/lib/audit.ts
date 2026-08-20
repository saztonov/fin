import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema/index.js';

export interface AuditEntry {
  userId?: string | null;
  ip?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: unknown;
}

/** Запись в audit_log. Ошибка аудита не должна ронять бизнес-операцию. */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId ?? null,
      ip: entry.ip ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      details: entry.details ?? null,
    });
  } catch {
    // намеренно глушим: аудит не критичен для выполнения операции
  }
}
