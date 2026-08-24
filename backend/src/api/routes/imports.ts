import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importFiles, importStaging } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { ApiError } from '../../lib/errors.js';
import { enqueue } from '../../lib/jobs/queue.js';
import { createLocalStorage } from '../../lib/storage/local.js';
import { guardXlsxUpload } from '../../lib/uploads/file-guard.js';
import { rejectionMessages, uploadLimits } from '../../lib/uploads/limits.js';
import {
  applyImport,
  applyImportBatch,
  buildPreview,
  type ApplyOptions,
} from '../../services/import-apply.service.js';
import { hasNonEmptyLegacy } from '../../services/parts.service.js';
import { assertObjectAccess, assertObjectExists } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().uuid() });

const splitSchema = z.object({
  /** лист книги для второй страницы */
  sheet: z.string().trim().min(1).max(200),
  firstPart: z.enum(['vat20', 'vat22']).default('vat20'),
  secondPart: z.enum(['vat20', 'vat22']).default('vat22'),
});

const applySchema = z.object({
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

/** Параметры применения обеих страниц: у каждой свои периоды и флаги. */
const batchApplySchema = z.object({
  parts: z
    .array(applySchema.extend({ importId: z.string().uuid() }))
    .min(1)
    .max(2),
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

      const data = await req.file();
      if (!data) throw ApiError.badRequest('Файл не передан', 'no_file');
      const kindRaw = (data.fields.kind as { value?: string } | undefined)?.value;
      const kind = z.enum(['psdc', 'ks6']).parse(kindRaw);
      // лист можно задать сразу; без него parse-child подберёт его сам
      const sheetName =
        (data.fields.sheet as { value?: string } | undefined)?.value?.slice(0, 200) || null;
      // часть сметы для этого листа; клиент может назвать вкладку только здесь,
      // при apply код уже берётся из БД
      const partCode = z
        .enum(['legacy', 'vat20', 'vat22'])
        .default('legacy')
        .parse((data.fields.part as { value?: string } | undefined)?.value ?? undefined);

      if (partCode !== 'legacy' && (await hasNonEmptyLegacy(app.db, id))) {
        throw ApiError.conflict(
          'По объекту уже загружена единая смета. Смешивать её с версиями по ставкам нельзя: сначала выполните «Очистить смету»',
          'legacy_estimate_exists',
        );
      }

      const guarded = await guardXlsxUpload(data.file, data.filename);
      if (data.file.truncated) {
        throw ApiError.badRequest(rejectionMessages.tooLarge(uploadLimits.maxBytes), 'too_large');
      }

      const storage = createLocalStorage();
      const storageKey = `${id}/${crypto.randomUUID()}.xlsx`;
      await storage.save(storageKey, guarded.buffer);

      const [created] = await app.db
        .insert(importFiles)
        .values({
          objectId: id,
          uploadedBy: req.authUser.id,
          kind,
          originalName: guarded.safeName,
          storageKey,
          sizeBytes: guarded.sizeBytes,
          sha256: guarded.sha256,
          mimeDetected: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sheetName,
          partCode,
          status: 'uploaded',
        })
        .returning();
      await enqueue(app.db, 'import_parse', { importFileId: created!.id });
      await writeAudit(app.db, {
        action: 'import.upload',
        userId: req.authUser.id,
        entityType: 'import',
        entityId: created!.id,
        details: {
          kind,
          part: partCode,
          name: guarded.safeName,
          size: guarded.sizeBytes,
          sha256: guarded.sha256,
        },
      });
      return reply.status(201).send(created);
    },
  );

  /**
   * Вторая страница КС из той же книги: запись импорта на тот же файл, но со своим
   * листом и своей частью. Файл не перезагружается — он уже в хранилище.
   */
  app.post(
    '/imports/:id/split',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const input = splitSchema.parse(req.body);
      const first = await getImportFile(app, id);
      await assertObjectAccess(app.db, req.authUser, first.objectId);
      if (first.status === 'applied') {
        throw ApiError.conflict('Импорт уже применён', 'already_applied');
      }
      if (input.sheet === first.sheetName) {
        throw ApiError.badRequest('Обе страницы указывают на один лист книги', 'same_sheet');
      }
      if (await hasNonEmptyLegacy(app.db, first.objectId)) {
        throw ApiError.conflict(
          'По объекту уже загружена единая смета. Смешивать её с версиями по ставкам нельзя: сначала выполните «Очистить смету»',
          'legacy_estimate_exists',
        );
      }

      const batchId = first.batchId ?? crypto.randomUUID();
      // первая запись получает свою часть и общий batch — до этого она могла быть
      // обычным одностраничным импортом
      await app.db
        .update(importFiles)
        .set({ batchId, partCode: input.firstPart, updatedAt: new Date() })
        .where(eq(importFiles.id, first.id));

      // парная запись уже есть (пользователь передумал и меняет лист) — переиспользуем
      const existingPair = await app.db
        .select()
        .from(importFiles)
        .where(and(eq(importFiles.batchId, batchId), eq(importFiles.partCode, input.secondPart)));
      const pair = existingPair.find((f) => f.id !== first.id);
      if (pair) {
        await app.db
          .update(importFiles)
          .set({ sheetName: input.sheet, status: 'uploaded', error: null, updatedAt: new Date() })
          .where(eq(importFiles.id, pair.id));
        await app.db.delete(importStaging).where(eq(importStaging.importFileId, pair.id));
        await enqueue(app.db, 'import_parse', { importFileId: pair.id });
        return { id: pair.id, batchId };
      }

      const [created] = await app.db
        .insert(importFiles)
        .values({
          objectId: first.objectId,
          uploadedBy: req.authUser.id,
          kind: first.kind,
          originalName: first.originalName,
          storageKey: first.storageKey,
          sizeBytes: first.sizeBytes,
          sha256: first.sha256,
          mimeDetected: first.mimeDetected,
          sheetName: input.sheet,
          batchId,
          partCode: input.secondPart,
          status: 'uploaded',
        })
        .returning();
      await enqueue(app.db, 'import_parse', { importFileId: created!.id });
      await writeAudit(app.db, {
        action: 'import.split',
        userId: req.authUser.id,
        entityType: 'import',
        entityId: created!.id,
        details: { batchId, sheet: input.sheet, part: input.secondPart },
      });
      return reply.status(201).send({ id: created!.id, batchId });
    },
  );

  app.get(
    '/objects/:id/imports',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      await assertObjectExists(app.db, req.authUser, id);
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
        .where(eq(importFiles.objectId, id))
        .orderBy(importFiles.createdAt);
    },
  );

  app.get(
    '/imports/:id',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertObjectAccess(app.db, req.authUser, file.objectId);
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
      await assertObjectAccess(app.db, req.authUser, file.objectId);
      return buildPreview(app.db, id);
    },
  );

  app.post(
    '/imports/:id/apply',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertObjectAccess(app.db, req.authUser, file.objectId);
      const options = applySchema.parse(req.body ?? {});
      if (options.overwriteKs2 && req.authUser.role !== 'admin') {
        throw ApiError.forbidden('Перезапись существующих КС-2 доступна только администратору');
      }
      return applyImport(app.db, id, options, req.authUser.id);
    },
  );

  /**
   * Применение обеих страниц книги одной транзакцией: падение второго листа
   * откатывает и первый, чтобы в портале не осталось половины сметы.
   */
  app.post(
    '/imports/batch/:id/apply',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id: batchId } = idParam.parse(req.params);
      const input = batchApplySchema.parse(req.body ?? {});
      const files = await app.db
        .select({ id: importFiles.id, objectId: importFiles.objectId })
        .from(importFiles)
        .where(eq(importFiles.batchId, batchId));
      if (files.length === 0) throw ApiError.notFound('Пара файлов импорта не найдена');
      await assertObjectAccess(app.db, req.authUser, files[0]!.objectId);

      const known = new Set(files.map((f) => f.id));
      const byImport = new Map<string, ApplyOptions>();
      for (const part of input.parts) {
        if (!known.has(part.importId)) {
          throw ApiError.badRequest('Файл импорта не входит в эту пару', 'bad_batch');
        }
        if (part.overwriteKs2 && req.authUser.role !== 'admin') {
          throw ApiError.forbidden('Перезапись существующих КС-2 доступна только администратору');
        }
        const { importId: _skip, ...options } = part;
        byImport.set(part.importId, options);
      }
      return applyImportBatch(app.db, batchId, byImport, req.authUser.id);
    },
  );

  // перечитать уже загруженный файл другим листом книги
  app.post(
    '/imports/:id/reparse',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertObjectAccess(app.db, req.authUser, file.objectId);
      if (file.status === 'applied') {
        throw ApiError.conflict('Импорт уже применён — перечитать нельзя', 'already_applied');
      }
      const { sheet } = z.object({ sheet: z.string().min(1).max(200) }).parse(req.body ?? {});
      await app.db
        .update(importFiles)
        .set({ sheetName: sheet, status: 'uploaded', error: null, updatedAt: new Date() })
        .where(eq(importFiles.id, id));
      await enqueue(app.db, 'import_parse', { importFileId: id });
      await writeAudit(app.db, {
        action: 'import.reparse',
        userId: req.authUser.id,
        entityType: 'import',
        entityId: id,
        details: { sheet },
      });
      return { message: `Файл поставлен на повторный разбор листа «${sheet}»` };
    },
  );

  app.post(
    '/imports/:id/discard',
    { preHandler: [app.authenticate, app.requireRole('admin', 'manager')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const file = await getImportFile(app, id);
      await assertObjectAccess(app.db, req.authUser, file.objectId);
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
      await assertObjectAccess(app.db, req.authUser, file.objectId);
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
