import { ApiError } from './errors.js';

/** Код части сметы. `legacy` — единая смета, ставка НДС определяется датой. */
export type PartCode = 'legacy' | 'vat20' | 'vat22';

export const PART_CODES: PartCode[] = ['legacy', 'vat20', 'vat22'];

/** Части со ставками — то, что показывается вкладками «НДС 20 %» / «НДС 22 %». */
export const SPLIT_CODES = ['vat20', 'vat22'] as const;
export type SplitCode = (typeof SPLIT_CODES)[number];

/** Дата, с которой действует ставка 22 % (см. VAT_SCHEDULE в money.ts). */
export const VAT22_FROM = '2026-01-01';
const VAT20_LAST_DAY = '2025-12-31';

export const PART_TITLE: Record<PartCode, string> = {
  legacy: 'Смета',
  vat20: 'НДС 20%',
  vat22: 'НДС 22%',
};

/** Ставка части; null для legacy — там ставка берётся по дате. */
export function partRate(code: PartCode): number | null {
  if (code === 'vat20') return 20;
  if (code === 'vat22') return 22;
  return null;
}

export function partSortOrder(code: PartCode): number {
  return code === 'vat20' ? 1 : code === 'vat22' ? 2 : 0;
}

/**
 * Попадает ли период в границы части. Принадлежность определяет КОНЕЦ периода:
 * акт закрывается на его последнюю дату, по ставке, действующей на тот момент.
 *
 * Иначе период через границу («КС2№1 01.12.2025-18.02.2026» у Садовнической)
 * не проходил бы ни во вкладку 20 % (кончается в 2026-м), ни во вкладку 22 %
 * (начинается в 2025-м), и молча пропадал при импорте. При этом плановые графики
 * 2026-2028 на листе «по 31.12.2025» (Сторис) вкладкой 20 % по-прежнему
 * отвергаются: они целиком лежат за её границей.
 *
 * Неизвестный период (обе даты пусты) не отвергаем: его дозаполняют вручную.
 */
export function periodFitsPart(
  code: PartCode,
  periodFrom: string | null | undefined,
  periodTo: string | null | undefined,
): boolean {
  if (code === 'legacy') return true;
  const end = periodTo || periodFrom;
  if (!end) return true;
  if (code === 'vat20') return end <= VAT20_LAST_DAY;
  return end >= VAT22_FROM;
}

/**
 * То же правило, но жёстко — для ручного ввода: создание КС-2 и PATCH. Там период
 * задаёт человек в открытой вкладке, и промах надо показать сразу, иначе документ,
 * законно созданный в своей части, переедет за границу ставки следующей правкой.
 *
 * При импорте правило применяется мягко (`periodFitsPart`): в реальных книгах лист
 * «по 31.12.2025» содержит ещё и плановый график на годы вперёд (Сторис.xlsx — 36
 * колонок до мая 2028), и падать на этом импорт не должен.
 */
export function assertPeriodFitsPart(
  code: PartCode,
  periodFrom: string | null | undefined,
  periodTo: string | null | undefined,
): void {
  if (periodFrom && periodTo && periodFrom > periodTo) {
    throw ApiError.badRequest('Начало периода позже его окончания', 'bad_period');
  }
  if (periodFitsPart(code, periodFrom, periodTo)) return;

  throw ApiError.badRequest(
    code === 'vat20'
      ? `Вкладка «${PART_TITLE.vat20}» закрывает периоды, оканчивающиеся по 31.12.2025 — с 01.01.2026 действует ставка 22 %`
      : `Вкладка «${PART_TITLE.vat22}» принимает периоды, оканчивающиеся с 01.01.2026 — более ранние вносятся во вкладку «${PART_TITLE.vat20}»`,
    'period_out_of_part',
  );
}

/**
 * Год для колонки, подписанной одним названием месяца («Январь»), когда книга не
 * даёт года. Для части 22 % он однозначен — 2026-й, первый год ставки. Для 20 %
 * год мог быть любым, поэтому там не угадываем.
 */
export function baseYearOfPart(code: PartCode): number | null {
  return code === 'vat22' ? 2026 : null;
}

/**
 * Часть, которой принадлежит период, — для разбора колонок книги при импорте.
 * Как и `periodFitsPart`, решает конец периода: акт закрывается на последнюю дату.
 */
export function partOfPeriod(
  periodFrom: string | null | undefined,
  periodTo?: string | null | undefined,
): SplitCode {
  const end = periodTo || periodFrom;
  return end && end >= VAT22_FROM ? 'vat22' : 'vat20';
}
