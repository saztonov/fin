import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../lib/errors.js';
import { guardXlsxUpload } from '../lib/uploads/file-guard.js';

function stream(buf: Buffer): NodeJS.ReadableStream {
  return Readable.from(buf);
}

async function makeXlsxLike(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

let validXlsx: Buffer;

beforeAll(async () => {
  validXlsx = await makeXlsxLike({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook/>',
    'xl/worksheets/sheet1.xml': '<worksheet/>',
  });
});

describe('file-guard (враждебные файлы)', () => {
  it('пропускает корректный xlsx и считает sha256', async () => {
    const res = await guardXlsxUpload(stream(validXlsx), 'смета.xlsx');
    expect(res.sizeBytes).toBe(validXlsx.length);
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.safeName).toBe('смета.xlsx');
  });

  it('отклоняет не-.xlsx расширение', async () => {
    await expect(guardXlsxUpload(stream(validXlsx), 'смета.xls')).rejects.toMatchObject({
      code: 'bad_extension',
    });
  });

  it('отклоняет файл с чужой сигнатурой (не zip)', async () => {
    const fake = Buffer.from('это точно не excel, а текст достаточной длины');
    await expect(guardXlsxUpload(stream(fake), 'смета.xlsx')).rejects.toMatchObject({
      code: 'bad_signature',
    });
  });

  it('отклоняет xlsm под именем xlsx (vbaProject.bin)', async () => {
    const macro = await makeXlsxLike({
      'xl/workbook.xml': '<workbook/>',
      'xl/vbaProject.bin': Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
    });
    await expect(guardXlsxUpload(stream(macro), 'смета.xlsx')).rejects.toMatchObject({
      code: 'macros',
    });
  });

  it('отклоняет zip без xl/workbook.xml', async () => {
    const notWb = await makeXlsxLike({ 'hello.txt': 'привет' });
    await expect(guardXlsxUpload(stream(notWb), 'смета.xlsx')).rejects.toMatchObject({
      code: 'not_workbook',
    });
  });

  it('отклоняет битый zip (сигнатура есть, контейнер сломан)', async () => {
    const broken = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64, 7)]);
    await expect(guardXlsxUpload(stream(broken), 'смета.xlsx')).rejects.toMatchObject({
      code: 'bad_container',
    });
  });

  it('отклоняет zip-бомбу по заявленному размеру распаковки', async () => {
    // 3 записи по ~200 МБ нулей: сжатие в ~0.1%, файл лёгкий, а заявленный размер огромный
    const big = Buffer.alloc(200 * 1024 * 1024, 0);
    const bomb = await makeXlsxLike({
      'xl/workbook.xml': '<workbook/>',
      'a.bin': big,
      'b.bin': big,
      'c.bin': big,
    });
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    await expect(guardXlsxUpload(stream(bomb), 'смета.xlsx')).rejects.toMatchObject({
      code: 'zip_bomb',
    });
  }, 120_000);

  it('нормализует имя: пути и управляющие символы удаляются', async () => {
    const res = await guardXlsxUpload(stream(validXlsx), '..\\..\\evil\r\nname.xlsx');
    expect(res.safeName).toBe('evilname.xlsx');
    const err = await guardXlsxUpload(stream(validXlsx), 'x.xlsx');
    expect(err.safeName).toBe('x.xlsx');
  });

  it('ApiError с понятным русским текстом', async () => {
    try {
      await guardXlsxUpload(stream(validXlsx), 'смета.xls');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toContain('.xlsx');
    }
  });
});
