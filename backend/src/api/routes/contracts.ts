import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { amendments, contracts } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';
import { assertContractAccess, assertObjectExists } from '../plugins/auth.js';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')
  .nullable()
  .optional();

const contractSchema = z.object({
  number: z.string().trim().min(1, 'Укажите номер договора').max(200),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Сумма — число с точностью до копеек').default('0'),
  dateSigned: dateStr,
  zosDate: dateStr,
  customerName: z.string().trim().max(1000).default(''),
  contractorName: z.string().trim().max(1000).default(''),
  subject: z.string().trim().max(4000).default(''),
});

const amendmentSchema = z.object({
  number: z.string().trim().min(1, 'Укажите номер ДС').max(100),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Сумма — число с точностью до копеек').default('0'),
  dateSigned: dateStr,
  zosExtensionDate: dateStr,
  note: z.string().trim().max(2000).default(''),
});

const idParam = z.object({ id: z.string().uuid() });

export async function contractRoutes(app: FastifyInstance) {
  app.get('/objects/:id/contract', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = idParam.parse(req.params);
    await assertObjectExists(app.db, req.authUser, id);
    const [contract] = await app.db
      .select()
      .from(contracts)
      .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
    if (!contract) return { contract: null, amendments: [] };
    const items = await app.db
      .select()
      .from(amendments)
      .where(and(eq(amendments.contractId, contract.id), isNull(amendments.deletedAt)))
      .orderBy(asc(amendments.createdAt));
    return { contract, amendments: items };
  });

  app.put(
    '/objects/:id/contract',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      await assertObjectExists(app.db, req.authUser, id);
      const input = contractSchema.parse(req.body);
      const [existing] = await app.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
      let result;
      if (existing) {
        [result] = await app.db
          .update(contracts)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(contracts.id, existing.id))
          .returning();
      } else {
        [result] = await app.db
          .insert(contracts)
          .values({ ...input, objectId: id })
          .returning();
      }
      await writeAudit(app.db, {
        action: existing ? 'contract.update' : 'contract.create',
        userId: req.authUser.id,
        entityType: 'contract',
        entityId: result?.id,
        details: input,
      });
      return result;
    },
  );

  app.post(
    '/contracts/:id/amendments',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await assertContractAccess(app.db, req.authUser, id);
      const input = amendmentSchema.parse(req.body);
      const dup = await app.db
        .select({ id: amendments.id })
        .from(amendments)
        .where(
          and(
            eq(amendments.contractId, id),
            eq(amendments.number, input.number),
            isNull(amendments.deletedAt),
          ),
        );
      if (dup.length > 0) throw ApiError.conflict('ДС с таким номером уже есть', 'amendment_taken');
      const [created] = await app.db
        .insert(amendments)
        .values({ ...input, contractId: id })
        .returning();
      await writeAudit(app.db, {
        action: 'amendment.create',
        userId: req.authUser.id,
        entityType: 'amendment',
        entityId: created?.id,
        details: input,
      });
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/amendments/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const input = amendmentSchema.partial().parse(req.body);
      const [row] = await app.db
        .select()
        .from(amendments)
        .where(and(eq(amendments.id, id), isNull(amendments.deletedAt)));
      if (!row) throw ApiError.notFound('ДС не найдено');
      await assertContractAccess(app.db, req.authUser, row.contractId);
      const [updated] = await app.db
        .update(amendments)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(amendments.id, id))
        .returning();
      await writeAudit(app.db, {
        action: 'amendment.update',
        userId: req.authUser.id,
        entityType: 'amendment',
        entityId: id,
        details: input,
      });
      return updated;
    },
  );

  app.delete(
    '/amendments/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const [row] = await app.db
        .select()
        .from(amendments)
        .where(and(eq(amendments.id, id), isNull(amendments.deletedAt)));
      if (!row) throw ApiError.notFound('ДС не найдено');
      await assertContractAccess(app.db, req.authUser, row.contractId);
      await app.db.update(amendments).set({ deletedAt: new Date() }).where(eq(amendments.id, id));
      await writeAudit(app.db, {
        action: 'amendment.delete',
        userId: req.authUser.id,
        entityType: 'amendment',
        entityId: id,
      });
      return { message: 'ДС удалено' };
    },
  );
}
