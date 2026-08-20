import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contracts, importFiles, importStaging } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';
import { enqueue } from '../../lib/jobs/queue.js';
import { createLocalStorage } from '../../lib/storage/local.js';
import { guardXlsxUpload } from '../../lib/uploads/file-guard.js';
import { rejectionMessages, uploadLimits } from '../../lib/uploads/limits.js';
import { applyImport, buildPreview } from '../../services/import-apply.service.js';
import { assertContractAccess, assertObjectExists } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().uuid() });

const applySchema = z.object({
  amendmentId: z.string().uuid().nullable().optional(),
  applyChanged: z.boolean().default(false),
  importHistory: z.boolean().default(true),
  overwriteKs2: z.boolean().default(false),
  approveImported: z.boolean().default(true),
  periods: z
    .array(
      z.object({
        index: z.number().int().min(0),
        number: z.string().trim().min(1).max(100),
        periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
    )
    .default([]),
});

async function getImportFile(app: FastifyInstance, id: string) {
  const [file] = await app.db.select().from(importFiles).where(eq(importFiles.id, id));
  if (!file) throw ApiError.notFound('Файл импорта не найден');
  return file;
}

export async function importRoutes(app: FastifyInstance) {
  app.post(
    '/objects/:id/imports',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await assertObjectExists(app.db, req.authUser, id);
      const [contract] = await app.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
      if (!contract) {
        throw ApiError.badRequest('Сначала заведите договор по объекту', 'no_contract');
      }

      const data = await req.file();
      if (!data) throw ApiError.badRequest('Файл не передан', 'no_file');
      const kindRaw = (data.fields.kind as { value?: string } | undefined)?.value;
      const kind = z.enum(['psdc', 'ks6']).parse(kindRaw);

      const guarded = await guardXlsxUpload(data.file, data.filename);
      if (data.file.truncated) {
        throw ApiError.badRequest(rejectionMessages.tooLarge(uploadLimits.maxBytes), 'too_large');
      }

      const storage = createLocalStorage();
      const storageKey = `${contract.id}/${crypto.randomUUID()}.xlsx`;
      await storage.save(storageKey, guarded.buffer);

      const [created] = await app.db
        .insert(importFiles)
        .values({
          contractId: contract.id,
          uploadedBy: req.authUser.id,
          kind,
          originalName: guarded.safeName,
          storageKey,
          sizeBytes: guarded.sizeBytes,
          sha256: guarded.sha256,
          mimeDetected: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          status: 'uploaded',
        })
        .returning();
      await enqueue(app.db, 'import_parse', { importFileId: created!.id });
      await writeAudit(app.db, {
        action: 'import.upload',
        userId: req.authUser.id,
        entityType: 'import',
        entityId: created!.id,
        details: { kind, name: guarded.safeName, size: guarded.sizeBytes, sha256: guarded.sha256 },
      });
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/objects/:id/imports',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      await assertObjectExists(app.db, req.authUser, id);
      const [contract] = await app.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.objectId, id), isNull(contracts.deletedAt)));
      if (!contract) return [];
      return app.db
        .select({
          id: importFiles.id,
          kind: importFiles.kind,
          originalName: importFiles.originalName,
          sizeBytes: importFiles.sizeBytes,
          status: importFiles.status,
          error: importFiles.error,
          createdAt: importFiles.createdAt,
        })
        .from(importFiles)
        .where(eq(importFiles.contractId, contract.id))
        .orderBy(importFiles.createdAt);
    },
  );

  app.get(
    '/imports/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertContractAccess(app.db, req.authUser, file.contractId);
      const [staging] = await app.db
        .select({ summary: importStaging.summary })
        .from(importStaging)
        .where(eq(importStaging.importFileId, id));
      return { ...file, summary: staging?.summary ?? null };
    },
  );

  app.get(
    '/imports/:id/preview',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertContractAccess(app.db, req.authUser, file.contractId);
      return buildPreview(app.db, id);
    },
  );

  app.post(
    '/imports/:id/apply',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertContractAccess(app.db, req.authUser, file.contractId);
      const options = applySchema.parse(req.body ?? {});
      if (options.overwriteKs2 && req.authUser.role !== 'admin') {
        throw ApiError.forbidden('Перезапись существующих КС-2 доступна только администратору');
      }
      return applyImport(app.db, id, options, req.authUser.id);
    },
  );

  app.post(
    '/imports/:id/discard',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertContractAccess(app.db, req.authUser, file.contractId);
      if (file.status === 'applied') {
        throw ApiError.conflict('Импорт уже применён — отклонить нельзя', 'already_applied');
      }
      await app.db
        .update(importFiles)
        .set({ status: 'discarded', updatedAt: new Date() })
        .where(eq(importFiles.id, id));
      return { message: 'Импорт отклонён' };
    },
  );

  // оригинал файла — только вложением, никогда inline (skill office-documents)
  app.get(
    '/imports/:id/file',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertContractAccess(app.db, req.authUser, file.contractId);
      const storage = createLocalStorage();
      const buffer = await storage.read(file.storageKey);
      const asciiName = file.originalName.replace(/[^\x20-\x7e]/g, '_');
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Content-Disposition',
          `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        );
      return reply.send(buffer);
    },
  );
}
