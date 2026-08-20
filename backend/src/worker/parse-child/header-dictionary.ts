/**
 * Словарь заголовков КС-6/ПСДЦ.
 *
 * Реальные книги заказчиков пишут одно и то же поле десятком способов
 * («Кол-во един.», «Объем по договору», «Количество*»), поэтому сопоставление идёт
 * не по точному равенству, а по нормализованному тексту и набору синонимов.
 */

/** Логическое поле колонки. */
export type HeaderField =
  | 'posNo'
  | 'code'
  | 'kind'
  | 'level'
  | 'name'
  | 'characteristic'
  | 'budgetArticle'
  | 'unit'
  | 'qty'
  | 'unitPrice'
  | 'total'
  | 'materialUnitPrice'
  | 'materialTotal'
  | 'workUnitPrice'
  | 'workTotal'
  | 'percent';

/** Роль группы граф справа от договорного блока. */
export type GroupRole = 'period' | 'executed' | 'remainder' | 'unknown';

/**
 * Нормализация заголовка: регистр, ё, скобочные пояснения, суффиксы про НДС и рубли,
 * висячая пунктуация. «Цена за ед. изм., руб, в т.ч. НДС» → «цена за ед изм».
 */
export function normHeader(raw: string): string {
  let s = String(raw ?? '').toLowerCase().replace(/ё/g, 'е');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/[*«»"'`]/g, ' ');
  s = s.replace(/[.,;:]/g, ' ');
  s = s.replace(/\s*[-–—]\s*/g, '-');
  // \b в JS не срабатывает на кириллице, поэтому чистим по границам пробелов
  s = ` ${s.replace(/\s+/g, ' ').trim()} `;
  const drops = [
    / в т ч ндс /g,
    / в тч ндс /g,
    / с учетом ндс /g,
    / (с|без) ндс /g,
    / ндс /g,
    / \d{1,2} ?% /g,
    / руб(лей)? /g,
  ];
  let prev: string;
  do {
    prev = s;
    for (const re of drops) s = s.replace(re, ' ');
  } while (s !== prev);
  s = s.replace(/ в $/, ' ');
  return s.trim().replace(/\s+/g, ' ');
}

/** Нормализованный текст для сравнения имён строк (разделы, позиции). */
export function normName(raw: string): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

const has = (s: string, ...parts: string[]) => parts.every((p) => s.includes(p));

/** Признак «эта графа про материалы» / «про работы» (группы в шапке РСР, ПСДЦ). */
function materialOrWork(s: string): 'material' | 'work' | null {
  if (s.includes('материал')) return 'material';
  if (/(^|[^а-я])работ/.test(s) && !s.includes('наименование')) return 'work';
  return null;
}

/**
 * Классификация одной графы договорного блока.
 * `context` — текст объединённого заголовка группы над графой, если есть
 * («Материалы» → «Цена за ед. изм.» становится ценой материала).
 */
export function classifyHeader(text: string, context = ''): HeaderField | null {
  const s = normHeader(text);
  const ctx = normHeader(context);
  if (!s) return null;

  if (/^n?\s*[№n]?\s*п\/п$/.test(s) || s === 'по порядку' || s === 'номер по порядку') return 'posNo';
  if (s === 'номер' || s === '№') return 'posNo';
  if (s === 'вид') return 'kind';
  if (s.startsWith('уровень')) return 'level';
  if (s.startsWith('наименование')) return 'name';

  if (s === 'шифр' || s === 'код квр' || s === '№ вида работ' || s === 'вид работ') return 'code';
  if (s === 'позиции по смете' || s === '№ позиции' || s === 'код нси ос') return 'code';

  if (s === 'статья бюджета' || s === 'код статьи затрат') return 'budgetArticle';

  if (s === 'характеристика' || s === 'комментарий') return 'characteristic';
  if (s.startsWith('применяемые материал')) return 'characteristic';

  if (/^ед(\.|)\s*изм/.test(s) || s === 'ед' || s === 'единица измерения') return 'unit';

  if (s === '%' || s.startsWith('% ')) return 'percent';

  const scope = materialOrWork(s) ?? materialOrWork(ctx);
  const perUnit = /за ед|на ед|единичная расценка|за единицу/.test(s);
  const isMoney = /цена|расценка|стоимость|ст-ть|сумма|всего|итого/.test(s);

  if (isMoney && scope === 'material') return perUnit ? 'materialUnitPrice' : 'materialTotal';
  if (isMoney && scope === 'work') return perUnit ? 'workUnitPrice' : 'workTotal';

  if (perUnit && isMoney) return 'unitPrice';
  if (has(s, 'цена')) return 'unitPrice';

  if (/^(кол-во|количество|объем)/.test(s)) return 'qty';

  if (/^(всего|стоимость|общая стоимость|общая ст-ть|ст-ть|сумма|итого)/.test(s)) return 'total';

  return null;
}

/** Роль группы граф по её подписи: контрольная, остаток или период выполнения. */
export function classifyGroup(label: string): GroupRole {
  const s = normHeader(label);
  if (!s) return 'unknown';
  if (s.includes('остаток')) return 'remainder';
  if (/с нач(ала|\.|)\s*(строительства|стр-ва|ст-ва|договора)/.test(s)) return 'executed';
  if (/выполнен(о|ие)\s*(всего|итого)/.test(s)) return 'executed';
  if (s === 'выполнено' || s === 'выполнение') return 'executed';
  if (isPeriodLabel(label)) return 'period';
  return 'unknown';
}

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** Похожа ли подпись на заголовок периода (акт КС-2, месяц, дата). */
export function isPeriodLabel(label: string): boolean {
  const s = normHeader(label);
  if (!s) return false;
  if (/(^|\s)(кс-?2?|акт)\s*№/.test(s)) return true;
  if (/^кс2?\s*№/.test(s)) return true;
  if (/^№\s*\d/.test(s)) return true;
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(s)) return true;
  // датовая ячейка приходит уже как ISO (Кинг, Событие — подпись графы это просто дата)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  if (MONTHS.some((m) => s.startsWith(m))) return true;
  return false;
}

export interface PeriodMeta {
  number: string | null;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  monthDate: string | null;
  /** индекс месяца 0..11, если подпись — только название месяца («Июнь») */
  monthIndex: number | null;
}

/** Индекс месяца в подписи вида «Июнь», «Март 2026 ч.2»; иначе null. */
export function monthIndexOf(label: string): number | null {
  const s = normHeader(label);
  const i = MONTHS.findIndex((m) => s.startsWith(m));
  return i >= 0 ? i : null;
}

const RU_DATE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g;

function toIso(dd: string, mm: string, yy: string): string | null {
  const year = yy.length === 2 ? `20${yy}` : yy;
  const iso = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * Разбор подписи периода. Покрывает встреченные в реальных книгах формы:
 * «Акт № 1 от 31.01.2026», «КС №9 от 10.01.2025г.», «КС-2 №9 (01.03.25-31.03.25)»,
 * «КС2№1 01.12.2025-18.02.2026», «№ 12 от 29.09.2023 СМР бетон», «Март 2026 ч.2», «Июнь».
 */
export function parsePeriodLabel(label: string, monthHint: string | null = null): PeriodMeta {
  const raw = String(label ?? '').replace(/\s+/g, ' ').trim();
  const meta: PeriodMeta = {
    number: null,
    docDate: null,
    periodFrom: null,
    periodTo: null,
    monthDate: monthHint,
    monthIndex: monthIndexOf(raw),
  };
  if (!raw) return meta;

  const iso = /^(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (iso) {
    meta.docDate = iso[1]!;
    meta.monthDate = `${iso[1]!.slice(0, 7)}-01`;
    return meta;
  }

  const num = raw.match(/(?:кс-?2?|акт|№)\s*№?\s*([0-9]+(?:[./-][0-9]+)*)/i);
  if (num) meta.number = num[1]!;

  const dates: string[] = [];
  RU_DATE.lastIndex = 0;
  for (const m of raw.matchAll(RU_DATE)) {
    const iso = toIso(m[1]!, m[2]!, m[3]!);
    if (iso) dates.push(iso);
  }

  const range = /(\d{1,2}\.\d{1,2}\.\d{2,4})\s*[-–—]\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(raw);
  if (range && dates.length >= 2) {
    meta.periodFrom = dates[0]!;
    meta.periodTo = dates[1]!;
  } else if (/\bот\b/i.test(raw) && dates.length >= 1) {
    meta.docDate = dates[0]!;
  } else if (dates.length === 1) {
    meta.docDate = dates[0]!;
  }

  if (!meta.monthDate && meta.monthIndex !== null) {
    const year = /(\d{4})/.exec(raw)?.[1];
    if (year) meta.monthDate = `${year}-${String(meta.monthIndex + 1).padStart(2, '0')}-01`;
  }
  if (!meta.monthDate && meta.periodFrom) meta.monthDate = meta.periodFrom;
  if (!meta.monthDate && meta.docDate) meta.monthDate = meta.docDate;

  return meta;
}
