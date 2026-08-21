import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contracts, ks2Documents, ks2Lines } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';
import { sumStrings } from '../../lib/money.js';
import * as ks2 from '../../services/ks2.service.js';
import { assertContractAccess, assertObjectExists } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().uuid() });

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')
  .nullable()
  .optional();

const docSchema = z.object({
  number: z.string().trim().min(1, 'Укажите номер').max(100),
  docDate: dateStr,
  periodFrom: dateStr,
  periodTo: dateStr,
});

const linesSchema = z.object({
  lines: z
    .array(
      z.object({
        workItemId: z.string().uuid(),
        qty: z.string().regex(/^-?\d+(\.\d+)?$/, 'Объём — число'),
      }),
    )
    .max(5000),
});

export async function ks2Routes(app: FastifyInstance) {
  app.get('/objects/:id/ks2', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    await assertObjectExists(app.db, req.authUser, id);
    const [contract] = await app.db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
    if (!contract) return [];
    return app.db
      .select()
      .from(ks2Documents)
      .where(and(eq(ks2Documents.contractId, contract.id), isNull(ks2Documents.deletedAt)));
  });

  app.post('/objects/:id/ks2', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await assertObjectExists(app.db, req.authUser, id);
    const input = docSchema.parse(req.body);
    const [contract] = await app.db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
    if (!contract) throw ApiError.badRequest('Сначала заведите договор по объекту', 'no_contract');
    await ks2.assertUniqueNumber(app.db, contract.id, input.number);
    const [created] = await app.db
      .insert(ks2Documents)
      .values({
        contractId: contract.id,
        number: input.number,
        docDate: input.docDate ?? null,
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
        createdBy: req.authUser.id,
      })
      .returning();
    await writeAudit(app.db, {
      action: 'ks2.create',
      userId: req.authUser.id,
      entityType: 'ks2',
      entityId: created?.id,
      details: input,
    });
    return reply.status(201).send(created);
  });

  app.get('/ks2/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    const doc = await ks2.getDocOrThrow(app.db, id);
    await assertContractAccess(app.db, req.authUser, doc.contractId);
    const lines = await app.db.select().from(ks2Lines).where(eq(ks2Lines.ks2DocumentId, id));
    return { ...doc, lines, totalAmount: sumStrings(lines.map((l) => l.amount)) };
  });

  app.patch('/ks2/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    const doc = await ks2.getDocOrThrow(app.db, id);
    await assertContractAccess(app.db, req.authUser, doc.contractId);
    if (doc.status !== 'draft') {
      throw ApiError.conflict('КС-2 утверждён — редактирование запрещено', 'ks2_approved');
    }
    const input = docSchema.partial().parse(req.body);
    if (input.number) await ks2.assertUniqueNumber(app.db, doc.contractId, input.number, id);
    const [updated] = await app.db
      .update(ks2Documents)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(ks2Documents.id, id))
      .returning();
    return updated;
  });

  app.put('/ks2/:id/lines', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    const doc = await ks2.getDocOrThrow(app.db, id);
    await assertContractAccess(app.db, req.authUser, doc.contractId);
    const input = linesSchema.parse(req.body);
    return ks2.setLines(app.db, id, input.lines, req.authUser.id);
  });

  app.post(
    '/ks2/:id/approve',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const doc = await ks2.getDocOrThrow(app.db, id);
      await assertContractAccess(app.db, req.authUser, doc.contractId);
      return ks2.approve(app.db, id, req.authUser.id);
    },
  );

  app.post(
    '/ks2/:id/return',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const doc = await ks2.getDocOrThrow(app.db, id);
      await assertContractAccess(app.db, req.authUser, doc.contractId);
      return ks2.returnToDraft(app.db, id, req.authUser.id);
    },
  );

  app.delete('/ks2/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    const doc = await ks2.getDocOrThrow(app.db, id);
    await assertContractAccess(app.db, req.authUser, doc.contractId);
    if (doc.status !== 'draft') {
      throw ApiError.conflict('Утверждённый КС-2 удалить нельзя', 'ks2_approved');
    }
    const isPrivileged = req.authUser.role === 'admin' || req.authUser.role === 'manager';
    if (!isPrivileged && doc.createdBy !== req.authUser.id) {
      throw ApiError.forbidden('Удалять можно только свои черновики');
    }
    await app.db
      .update(ks2Documents)
      .set({ deletedAt: new Date() })
      .where(eq(ks2Documents.id, id));
    await writeAudit(app.db, {
      action: 'ks2.delete',
      userId: req.authUser.id,
      entityType: 'ks2',
      entityId: id,
      details: { number: doc.number },
    });
    return { message: 'КС-2 удалён' };
  });

  /** Очистка всей истории КС-2 по объекту — под перезаливку исправленного Excel. */
  app.delete(
    '/objects/:id/ks2',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      await assertObjectExists(app.db, req.authUser, id);
      const [contract] = await app.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
      if (!contract) throw ApiError.badRequest('По объекту нет договора', 'no_contract');
      const res = await ks2.clearByContract(app.db, contract.id, req.authUser.id);
      return { message: `Удалено КС-2: ${res.documents}, строк выполнения: ${res.lines}`, ...res };
    },
  );
}
