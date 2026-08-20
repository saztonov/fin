import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ks2Lines, ks6Sections, workItems } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';
import { lineAmount } from '../../lib/money.js';
import { getKs6Grid } from '../../services/ks6.service.js';
import { assertContractAccess, assertObjectExists } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().uuid() });

const numStr = (msg: string) => z.string().regex(/^-?\d+(\.\d+)?$/, msg);

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(500),
  parentId: z.string().uuid().nullable().optional(),
  amendmentId: z.string().uuid().nullable().optional(),
  afterSortOrder: z.number().int().optional(),
});

const workItemSchema = z.object({
  sectionId: z.string().uuid(),
  kind: z.enum(['kvr', 'nomenclature']),
  kvrItemId: z.string().uuid().nullable().optional(),
  kvrCode: z.string().trim().max(100).default(''),
  name: z.string().trim().min(1).max(1000),
  characteristic: z.string().trim().max(2000).default(''),
  unit: z.string().trim().max(50).default(''),
  contractQty: numStr('Количество — число').default('0'),
  unitPrice: numStr('Цена — число').default('0'),
  materialUnitCost: numStr('Стоимость материала — число').nullable().optional(),
  workUnitCost: numStr('Стоимость работ — число').nullable().optional(),
  contractTotal: numStr('Всего — число').optional(),
  amendmentId: z.string().uuid().nullable().optional(),
  afterSortOrder: z.number().int().optional(),
});

async function nextSortOrder(app: FastifyInstance, contractId: string, after?: number) {
  if (after !== undefined) return after + 5;
  const items = await app.db
    .select({ sortOrder: workItems.sortOrder })
    .from(workItems)
    .where(eq(workItems.contractId, contractId));
  const sections = await app.db
    .select({ sortOrder: ks6Sections.sortOrder })
    .from(ks6Sections)
    .where(eq(ks6Sections.contractId, contractId));
  const max = Math.max(0, ...items.map((i) => i.sortOrder), ...sections.map((s) => s.sortOrder));
  return max + 10;
}

export async function ks6Routes(app: FastifyInstance) {
  app.get('/objects/:id/ks6', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    await assertObjectExists(app.db, req.authUser, id);
    return getKs6Grid(app.db, id);
  });

  app.post(
    '/contracts/:id/sections',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await assertContractAccess(app.db, req.authUser, id);
      const input = sectionSchema.parse(req.body);
      const [created] = await app.db
        .insert(ks6Sections)
        .values({
          contractId: id,
          name: input.name,
          parentId: input.parentId ?? null,
          amendmentId: input.amendmentId ?? null,
          sortOrder: await nextSortOrder(app, id, input.afterSortOrder),
        })
        .returning();
      await writeAudit(app.db, {
        action: 'section.create',
        userId: req.authUser.id,
        entityType: 'section',
        entityId: created?.id,
      });
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/sections/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const input = sectionSchema.partial().parse(req.body);
      const [row] = await app.db
        .select()
        .from(ks6Sections)
        .where(and(eq(ks6Sections.id, id), isNull(ks6Sections.deletedAt)));
      if (!row) throw ApiError.notFound('Раздел не найден');
      await assertContractAccess(app.db, req.authUser, row.contractId);
      const [updated] = await app.db
        .update(ks6Sections)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.amendmentId !== undefined ? { amendmentId: input.amendmentId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(ks6Sections.id, id))
        .returning();
      return updated;
    },
  );

  app.delete(
    '/sections/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const [row] = await app.db
        .select()
        .from(ks6Sections)
        .where(and(eq(ks6Sections.id, id), isNull(ks6Sections.deletedAt)));
      if (!row) throw ApiError.notFound('Раздел не найден');
      await assertContractAccess(app.db, req.authUser, row.contractId);
      const children = await app.db
        .select({ id: ks6Sections.id })
        .from(ks6Sections)
        .where(and(eq(ks6Sections.parentId, id), isNull(ks6Sections.deletedAt)));
      const items = await app.db
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(eq(workItems.sectionId, id), isNull(workItems.deletedAt)));
      if (children.length > 0 || items.length > 0) {
        throw ApiError.conflict('Раздел не пуст: сначала удалите вложенные строки', 'section_not_empty');
      }
      await app.db.update(ks6Sections).set({ deletedAt: new Date() }).where(eq(ks6Sections.id, id));
      return { message: 'Раздел удалён' };
    },
  );

  app.post(
    '/contracts/:id/work-items',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await assertContractAccess(app.db, req.authUser, id);
      const input = workItemSchema.parse(req.body);
      const [section] = await app.db
        .select({ id: ks6Sections.id, contractId: ks6Sections.contractId })
        .from(ks6Sections)
        .where(and(eq(ks6Sections.id, input.sectionId), isNull(ks6Sections.deletedAt)));
      if (!section || section.contractId !== id) {
        throw ApiError.badRequest('Раздел не принадлежит договору', 'bad_section');
      }
      const contractTotal = input.contractTotal ?? lineAmount(input.contractQty, input.unitPrice);
      const [created] = await app.db
        .insert(workItems)
        .values({
          contractId: id,
          sectionId: input.sectionId,
          kind: input.kind,
          kvrItemId: input.kvrItemId ?? null,
          kvrCode: input.kvrCode,
          name: input.name,
          characteristic: input.characteristic,
          unit: input.unit,
          contractQty: input.contractQty,
          unitPrice: input.unitPrice,
          materialUnitCost: input.materialUnitCost ?? null,
          workUnitCost: input.workUnitCost ?? null,
          contractTotal,
          amendmentId: input.amendmentId ?? null,
          sortOrder: await nextSortOrder(app, id, input.afterSortOrder),
        })
        .returning();
      await writeAudit(app.db, {
        action: 'work_item.create',
        userId: req.authUser.id,
        entityType: 'work_item',
        entityId: created?.id,
      });
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/work-items/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const input = workItemSchema.partial().parse(req.body);
      const [row] = await app.db
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, id), isNull(workItems.deletedAt)));
      if (!row) throw ApiError.notFound('Строка не найдена');
      await assertContractAccess(app.db, req.authUser, row.contractId);
      const { afterSortOrder: _skip, sectionId: _s, kind: _k, ...patch } = input;
      const [updated] = await app.db
        .update(workItems)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(workItems.id, id))
        .returning();
      await writeAudit(app.db, {
        action: 'work_item.update',
        userId: req.authUser.id,
        entityType: 'work_item',
        entityId: id,
        details: patch,
      });
      return updated;
    },
  );

  app.delete(
    '/work-items/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const [row] = await app.db
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, id), isNull(workItems.deletedAt)));
      if (!row) throw ApiError.notFound('Строка не найдена');
      await assertContractAccess(app.db, req.authUser, row.contractId);
      const usage = await app.db
        .select({ id: ks2Lines.id })
        .from(ks2Lines)
        .where(eq(ks2Lines.workItemId, id))
        .limit(1);
      if (usage.length > 0) {
        throw ApiError.conflict('По строке есть выполнение в КС-2 — удаление запрещено', 'item_in_use');
      }
      await app.db.update(workItems).set({ deletedAt: new Date() }).where(eq(workItems.id, id));
      return { message: 'Строка удалена' };
    },
  );
}
