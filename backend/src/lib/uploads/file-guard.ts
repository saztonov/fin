import crypto from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { ApiError } from '../errors.js';
import { rejectionMessages, uploadLimits } from './limits.js';

export interface GuardedFile {
  buffer: Buffer;
  sha256: string;
  sizeBytes: number;
  /** нормализованное имя без путей и управляющих символов */
  safeName: string;
}

/** Сигнатура zip: PK\x03\x04 — решение принимается по накопленным >= 8 байтам. */
function hasZipSignature(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

function normalizeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  // управляющие символы и переводы строк — вон
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'file.xlsx';
}

/**
 * Единая точка приёма офисных файлов (skill office-documents):
 * расширение → сигнатура по >=8 байтам → накопление с лимитом →
 * инспекция zip-оглавления (workbook есть, макросов нет, разумные размеры).
 * Отвергнутый файл не сохраняется ни байтом (буфер в памяти до решения).
 * Разбор содержимого книги здесь НЕ выполняется — только контейнер.
 */
export async function guardXlsxUpload(
  stream: NodeJS.ReadableStream,
  originalName: string,
): Promise<GuardedFile> {
  const ext = path.extname(originalName).toLowerCase();
  if (!uploadLimits.allowedExtensions.includes(ext)) {
    throw ApiError.badRequest(rejectionMessages.badExtension, 'bad_extension');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let signatureChecked = false;
  let head = Buffer.alloc(0);

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > uploadLimits.maxBytes) {
      throw ApiError.badRequest(rejectionMessages.tooLarge(uploadLimits.maxBytes), 'too_large');
    }
    if (!signatureChecked) {
      head = Buffer.concat([head, buf]);
      if (head.length >= 8) {
        if (!hasZipSignature(head)) {
          throw ApiError.badRequest(rejectionMessages.badSignature, 'bad_signature');
        }
        signatureChecked = true;
      }
    }
    chunks.push(buf);
  }
  // fastify/multipart обрывает поток на лимите — проверяем флаг truncated снаружи
  if (!signatureChecked) {
    throw ApiError.badRequest(rejectionMessages.badSignature, 'bad_signature');
  }

  const buffer = Buffer.concat(chunks);

  // инспекция оглавления контейнера (без распаковки содержимого)
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch {
    throw ApiError.badRequest(rejectionMessages.encrypted, 'bad_container');
  }
  const entries = Object.keys(zip.files);
  if (entries.length > uploadLimits.maxZipEntries) {
    throw ApiError.badRequest(rejectionMessages.zipBomb, 'zip_bomb');
  }
  if (entries.some((e) => /vbaProject\.bin$/i.test(e))) {
    throw ApiError.badRequest(rejectionMessages.hasMacros, 'macros');
  }
  if (!entries.some((e) => e === 'xl/workbook.xml')) {
    throw ApiError.badRequest(rejectionMessages.notWorkbook, 'not_workbook');
  }
  // заявленные размеры распакованного содержимого из оглавления
  let declared = 0;
  for (const name of entries) {
    const data = (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data;
    if (data?.uncompressedSize && data.uncompressedSize > 0) declared += data.uncompressedSize;
  }
  if (declared > uploadLimits.maxDeclaredUncompressed) {
    throw ApiError.badRequest(rejectionMessages.zipBomb, 'zip_bomb');
  }

  return {
    buffer,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.length,
    safeName: normalizeName(originalName),
  };
}
