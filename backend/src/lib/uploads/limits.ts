/** Пороги и тексты отказов приёма файлов — единственное место (skill office-documents). */
import { loadConfig } from '../../config.js';

export const uploadLimits = {
  get maxBytes() {
    return loadConfig().UPLOAD_MAX_BYTES;
  },
  /** максимум записей в zip-оглавлении xlsx */
  maxZipEntries: 10_000,
  /** максимальный суммарный заявленный размер распакованных данных, байт (защита от zip-бомбы) */
  maxDeclaredUncompressed: 400 * 1024 * 1024,
  allowedExtensions: ['.xlsx'],
};

export const rejectionMessages = {
  tooLarge: (max: number) =>
    `Файл больше допустимых ${Math.round(max / 1024 / 1024)} МБ. Уменьшите файл или обратитесь к администратору.`,
  badExtension: 'Принимаются только файлы .xlsx. Формат .xls сохраните в Excel как .xlsx.',
  badSignature: 'Файл не является книгой Excel (.xlsx): содержимое не соответствует формату.',
  hasMacros: 'Файл содержит макросы (xlsm под именем xlsx) — приём запрещён.',
  notWorkbook: 'Внутри архива нет книги Excel (xl/workbook.xml).',
  zipBomb: 'Файл отклонён: превышены пределы содержимого архива.',
  encrypted: 'Файл зашифрован или повреждён — снимите защиту и повторите загрузку.',
} as const;
