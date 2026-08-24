import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit.js';
import * as ks2 from '../../services/ks2.service.js';
import { exportKs2 } from '../../services/export/export-ks2.js';
import { exportKs6 } from '../../services/export/export-ks6.js';
import { assertObjectExists, assertPartAccess } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().uuid() });

function sendXlsx(reply: FastifyReply, buffer: Buffer, filename: string) {
  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');
  reply
    .header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    .header('X-Content-Type-Options', 'nosniff')
    .header(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
  return reply.send(buffer);
}

export async function exportRoutes(app: FastifyInstance) {
  app.get('/objects/:id/export/ks6.xlsx', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await assertObjectExists(app.db, req.authUser, id);
    const { buffer, filename } = await exportKs6(app.db, id);
    await writeAudit(app.db, {
      action: 'export.ks6',
      userId: req.authUser.id,
      entityType: 'object',
      entityId: id,
      details: { size: buffer.length },
    });
    return sendXlsx(reply, buffer, filename);
  });

  app.get('/ks2/:id/export.xlsx', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const doc = await ks2.getDocOrThrow(app.db, id);
    await assertPartAccess(app.db, req.authUser, doc.partId);
    const { buffer, filename } = await exportKs2(app.db, id);
    await writeAudit(app.db, {
      action: 'export.ks2',
      userId: req.authUser.id,
      entityType: 'ks2',
      entityId: id,
      details: { size: buffer.length },
    });
    return sendXlsx(reply, buffer, filename);
  });
}
