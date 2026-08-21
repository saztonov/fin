import { z } from 'zod';

/** Версия парсера — пишется в import_files.parser_version. */
export const PARSER_VERSION = '2.1.0';

/**
 * Допуск при сверке с контрольными суммами файла, рубли. Абсолютный, а не в
 * процентах: на договоре в 18 млрд «0,1 %» — это 18 млн рублей. Реальные книги
 * заказчиков расходятся на копейки округления, и в рубль они укладываются.
 */
export const TOTALS_EPS = 1;

const numStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const parsedSectionSchema = z.object({
  tmpId: z.string(),
  parentTmpId: z.string().nullable(),
  name: z.string().min(1),
  /** реальные ведомости доходят до 7 уровней (Примавера — колонка «Уровень 7») */
  level: z.number().int().min(1).max(12),
  rowNumber: z.number().int(),
});

export const parsedItemSchema = z.object({
  tmpId: z.string(),
  sectionTmpId: z.string(),
  /** subline — строки «в т.ч.»: хранятся и показываются, но в суммы не входят */
  kind: z.enum(['kvr', 'nomenclature', 'subline']),
  kvrTmpId: z.string().nullable(),
  kvrCode: z.string(),
  name: z.string().min(1),
  characteristic: z.string(),
  unit: z.string(),
  contractQty: numStr,
  unitPrice: numStr,
  materialUnitCost: numStr.nullable(),
  workUnitCost: numStr.nullable(),
  contractTotal: numStr,
  /**
   * Контрольная графа «Выполнено с начала строительства» по этой строке. Не
   * импортируется как данные — накопительный итог портал считает сам; хранится,
   * чтобы грид КС-6 постоянно показывал расхождение с исходным Excel.
   */
  fileExecutedTotal: numStr.nullable(),
  budgetArticle: z.string(),
  rowNumber: z.number().int(),
});

export const parsedKs2ColumnSchema = z.object({
  index: z.number().int(),
  label: z.string().nullable(),
  /** номер КС-2, извлечённый из подписи («9» из «КС-2 №9») */
  number: z.string().nullable(),
  monthDate: z.string().nullable(),
  docDate: z.string().nullable(),
  periodFrom: z.string().nullable(),
  periodTo: z.string().nullable(),
  cells: z.array(
    z.object({
      itemTmpId: z.string(),
      qty: numStr,
      amount: numStr,
    }),
  ),
});

export const parsedImportSchema = z.object({
  kind: z.enum(['psdc', 'ks6']),
  /** лист, с которого фактически прочитаны данные */
  sheetName: z.string(),
  /** все листы книги — мастер импорта даёт переключиться на другой */
  sheetCandidates: z
    .array(
      z.object({
        name: z.string(),
        state: z.enum(['visible', 'hidden', 'veryHidden']),
        score: z.number().nullable(),
        rows: z.number().nullable(),
        periods: z.number().nullable(),
      }),
    )
    .default([]),
  /** ставка НДС и режим цен, вычитанные из подписей граф; null — не удалось понять */
  vat: z.object({
    rate: z.number().nullable(),
    mode: z.enum(['gross', 'net']).nullable(),
  }),
  header: z.object({
    contractNumber: z.string().nullable(),
    contractDate: z.string().nullable(),
    amendmentNumber: z.string().nullable(),
    amendmentDate: z.string().nullable(),
  }),
  sections: z.array(parsedSectionSchema),
  items: z.array(parsedItemSchema),
  ks2Columns: z.array(parsedKs2ColumnSchema),
  controls: z.object({
    /** «Итого, руб., в т.ч. НДС» по договору из файла */
    contractTotal: z.string().nullable(),
    /** «НДС 20%» из файла */
    vat: z.string().nullable(),
    /** контрольная колонка «Выполнение с нач. ст-ва» на строке Итого */
    executedTotal: z.string().nullable(),
  }),
  warnings: z.array(z.string()),
});

export type ParsedImport = z.infer<typeof parsedImportSchema>;
export type ParsedSection = z.infer<typeof parsedSectionSchema>;
export type ParsedItem = z.infer<typeof parsedItemSchema>;
export type ParsedKs2Column = z.infer<typeof parsedKs2ColumnSchema>;

export const childOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: parsedImportSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
