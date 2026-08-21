/**
 * Разметка граф выполнения справа от договорного блока.
 *
 * Группа периода в реальных книгах — это две или три графы («Кол-во / Стоимость»,
 * «Кол-во / Расценка / Общая ст-ть», «Количество / Стоимость / Стоимость с начала
 * строительства»), а подпись группы лежит либо в объединённой ячейке над ними, либо
 * в самой строке шапки, либо (Примавера) в отдельном блоке «Номер документа / Дата
 * составления / Отчетный период» выше таблицы.
 *
 * Контрольные группы («Выполнено всего», «Остаток») распознаются и НЕ импортируются:
 * портал считает накопительный итог сам.
 */
import {
  classifyGroup,
  classifyHeader,
  isPeriodLabel,
  parsePeriodLabel,
  type GroupRole,
  type PeriodMeta,
} from './header-dictionary.js';
import type { HeaderLayout } from './header-detect.js';
import { cellDate, cellNum, cellText } from './sheet-utils.js';
import type { SheetGrid } from './xlsx-reader.js';

export interface PeriodGroup {
  label: string;
  qtyCol: number | null;
  priceCol: number | null;
  amountCol: number;
  meta: PeriodMeta;
}

export interface ControlGroup {
  label: string;
  role: Exclude<GroupRole, 'period' | 'unknown'>;
  qtyCol: number | null;
  amountCol: number;
}

export interface PeriodGroups {
  periods: PeriodGroup[];
  controls: ControlGroup[];
  warnings: string[];
}

const MAX_SCAN_COL = 600;
/** Сколько строк данных проверяем, решая, есть ли в графе хоть что-нибудь. */
const DATA_PROBE_ROWS = 500;

type SubField = 'qty' | 'total' | 'unitPrice' | 'percent';

interface RawGroup {
  label: string;
  monthHint: string | null;
  cols: { col: number; field: SubField | null }[];
}

/** Подпись графы внутри группы: ищем в строках блока шапки и одной строке под ним. */
function subFieldOf(ws: SheetGrid, layout: HeaderLayout, col: number): SubField | null {
  const from = layout.headerRow;
  const to = Math.min(layout.headerRow + Math.max(layout.headerHeight, 2), layout.dataStartRow - 1);
  for (let r = from; r <= to; r++) {
    const t = cellText(ws, r, col);
    if (!t) continue;
    const f = classifyHeader(t);
    if (f === 'qty' || f === 'total' || f === 'unitPrice' || f === 'percent') return f;
    // в графах выполнения «работ» — это «выполненных работ», а не раздел «Работы»
    // («Стоимость работ, руб., с НДС-20%» у Примаверы — обычная сумма периода)
    if (f === 'materialTotal' || f === 'workTotal') return 'total';
    if (f === 'materialUnitPrice' || f === 'workUnitPrice') return 'unitPrice';
  }
  return null;
}

/**
 * Подпись группы для колонки. Сначала ищем строку, которая читается как заголовок
 * группы («Акт № 1 от …», «ВЫПОЛНЕНО С НАЧАЛА СТРОИТЕЛЬСТВА», дата), и только потом
 * отбрасываем обычные подписи граф («Кол-во», «Стоимость»).
 */
const ISO_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** «Сильная» подпись — та, что действительно называет блок: акт, дата, контроль. */
function isStrongLabel(label: string): boolean {
  return label !== '' && (isPeriodLabel(label) || classifyGroup(label) !== 'unknown');
}

/**
 * Число подписью группы быть не может. Над таблицей нередко висит титульная строка
 * с суммами и черновые расчёты автора файла (ЗИЛ: «286954351,248» в графе 142) —
 * подписью акта их считать нельзя. Номер акта («12») числом тоже выглядит, поэтому
 * отбрасываются только заведомо не-номера: дробные, отрицательные и ≥ 1000.
 */
function isStrayNumber(text: string): boolean {
  const s = text.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return false;
  const n = Number(s);
  return !Number.isInteger(n) || n < 0 || n >= 1000;
}

function labelOf(
  ws: SheetGrid,
  layout: HeaderLayout,
  col: number,
): { label: string; monthHint: string | null } {
  const from = Math.max(1, layout.headerRow - 3);
  const to = layout.headerRow + layout.headerHeight - 1;
  const texts: string[] = [];
  for (let r = from; r <= to; r++) {
    const t = cellText(ws, r, col);
    if (t && !isStrayNumber(t)) texts.push(t);
  }
  // над блоком периода часто стоят две строки: голая дата месяца и подпись акта.
  // Подпись информативнее, дата остаётся подсказкой месяца.
  const monthHint = texts.find((t) => ISO_ONLY.test(t)) ?? null;
  // «период» приоритетнее «контроля»: у Инджоя третья графа каждого акта
  // подписана «…с начала строительства», а сам акт — строкой выше
  const rich = texts.find((t) => isPeriodLabel(t) && !ISO_ONLY.test(t));
  if (rich) return { label: rich, monthHint };
  if (monthHint) return { label: monthHint, monthHint };
  const control = texts.find((t) => classifyGroup(t) !== 'unknown');
  if (control) return { label: control, monthHint };
  return { label: texts.find((t) => classifyHeader(t) === null) ?? '', monthHint };
}

/**
 * Профиль «метаданные вертикальным блоком» (Примавера): над таблицей идут строки
 * «Номер документа», «Дата составления», «Отчетный период с/по», а значения стоят
 * ровно в тех же колонках, что и графы выполнения.
 */
function verticalMeta(ws: SheetGrid, layout: HeaderLayout): Map<number, PeriodMeta> {
  const out = new Map<number, PeriodMeta>();
  let numberRow: number | null = null;
  let periodRow: number | null = null;

  for (let r = 1; r < layout.headerRow; r++) {
    for (let c = 1; c <= Math.min(ws.columnCount, MAX_SCAN_COL); c++) {
      const t = cellText(ws, r, c).toLowerCase();
      if (!t) continue;
      if (numberRow === null && t === 'номер' && cellText(ws, r + 1, c).toLowerCase() === 'документа') {
        numberRow = r + 2;
      }
      if (periodRow === null && t.startsWith('отчетный период')) {
        periodRow = r + 2;
      }
      if (numberRow !== null && periodRow !== null) break;
    }
    if (numberRow !== null && periodRow !== null) break;
  }
  if (numberRow === null && periodRow === null) return out;

  for (let c = layout.lastContractCol + 1; c <= Math.min(ws.columnCount, MAX_SCAN_COL); c++) {
    const number = numberRow ? cellText(ws, numberRow, c) : '';
    const docDate = numberRow ? cellDate(ws, numberRow, c + 1) : null;
    const from = periodRow ? cellDate(ws, periodRow, c) : null;
    const to = periodRow ? cellDate(ws, periodRow, c + 1) : null;
    if (!number && !from) continue;
    if (number && !/^\d/.test(number)) continue;
    out.set(c, {
      number: number || null,
      docDate,
      periodFrom: from,
      periodTo: to,
      monthDate: from ?? docDate,
      monthIndex: null,
    });
  }
  return out;
}

/**
 * Подписи вида «Июнь», «Июль», … года не содержат (Сторис). Год восстанавливается
 * по порядку: он растёт там, где месяц не больше предыдущего.
 */
function fillMonthYears(periods: PeriodGroup[], yearHint: number | null): void {
  let year = yearHint;
  let prevIndex: number | null = null;
  for (const p of periods) {
    const known = p.meta.periodFrom ?? p.meta.docDate ?? p.meta.monthDate;
    if (known) {
      year = Number(known.slice(0, 4));
      prevIndex = Number(known.slice(5, 7)) - 1;
      continue;
    }
    if (p.meta.monthIndex === null || year === null) continue;
    if (prevIndex !== null && p.meta.monthIndex <= prevIndex) year += 1;
    p.meta.monthDate = `${year}-${String(p.meta.monthIndex + 1).padStart(2, '0')}-01`;
    prevIndex = p.meta.monthIndex;
  }
}

/** Есть ли в графе хоть одно число в строках данных (выборка сверху таблицы). */
function hasData(ws: SheetGrid, layout: HeaderLayout, col: number): boolean {
  const to = Math.min(ws.rowCount, layout.dataStartRow + DATA_PROBE_ROWS);
  for (let r = layout.dataStartRow; r <= to; r++) {
    if (cellNum(ws, r, col) !== null) return true;
  }
  return false;
}

export function detectPeriodGroups(
  ws: SheetGrid,
  layout: HeaderLayout,
  opts: { yearHint?: number | null } = {},
): PeriodGroups {
  const warnings: string[] = [];
  const start = layout.lastContractCol + 1;
  const end = Math.min(ws.columnCount, MAX_SCAN_COL);

  const raw: RawGroup[] = [];
  let current: RawGroup | null = null;
  let emptyRun = 0;

  for (let c = start; c <= end; c++) {
    const field = subFieldOf(ws, layout, c);
    const { label, monthHint } = labelOf(ws, layout, c);

    if (!field && !label) {
      emptyRun += 1;
      // короткий хвост — часть текущей группы (Кинг/Садовническая: графы без подписей)
      if (current && emptyRun <= 2) current.cols.push({ col: c, field: null });
      else if (current) {
        raw.push(current);
        current = null;
      }
      // длинный пустой промежуток — таблица кончилась, дальше служебные колонки
      if (emptyRun > 25 && raw.length) break;
      continue;
    }
    emptyRun = 0;

    const hasAmount = current?.cols.some((x) => x.field === 'total') ?? false;
    // общая надпись над всем блоком выполнения («В т.ч. за отчетный месяц»,
    // «Выполнено работ в текущем периоде») группу не разрезает — режет только
    // подпись конкретного акта, которая стоит над первой графой пары
    const labelChanged = current !== null && isStrongLabel(label) && label !== current.label;
    const newByShape = current !== null && field === 'qty' && hasAmount;

    if (!current || labelChanged || newByShape) {
      if (current) raw.push(current);
      current = { label, monthHint, cols: [] };
    } else if (label && (current.label === '' || (!isStrongLabel(current.label) && isStrongLabel(label)))) {
      current.label = label;
      current.monthHint ??= monthHint;
    } else {
      current.monthHint ??= monthHint;
    }
    current.cols.push({ col: c, field });
  }
  if (current) raw.push(current);

  const vmeta = verticalMeta(ws, layout);
  const periods: PeriodGroup[] = [];
  const controls: ControlGroup[] = [];

  for (const g of raw) {
    let qtyCol = g.cols.find((x) => x.field === 'qty')?.col ?? null;
    let priceCol = g.cols.find((x) => x.field === 'unitPrice')?.col ?? null;
    const totals = g.cols.filter((x) => x.field === 'total');
    let amountCol: number | null = totals.length ? totals[0]!.col : null;

    // группа без подзаголовков (Кинг: только дата над парой граф) — раскладка по ширине
    if (amountCol === null && g.cols.every((x) => x.field === null)) {
      const cols = g.cols.map((x) => x.col);
      if (cols.length === 1) amountCol = cols[0]!;
      else if (cols.length === 2) {
        qtyCol = cols[0]!;
        amountCol = cols[1]!;
      } else if (cols.length >= 3) {
        qtyCol = cols[0]!;
        priceCol = cols[1]!;
        amountCol = cols[2]!;
      }
    }
    if (amountCol === null) continue;

    const role = classifyGroup(g.label);
    if (role === 'executed' || role === 'remainder') {
      controls.push({ label: g.label, role, qtyCol, amountCol });
      continue;
    }

    const anchor = qtyCol ?? amountCol;
    const fromBlock = vmeta.get(anchor) ?? vmeta.get(amountCol) ?? null;

    // справа от таблицы часто висят рабочие колонки автора файла («ПРОВЕРКА», «не
    // печатать», «Выполнено в 2025 г») — у них подпись есть, но она не про период
    if (!fromBlock && g.label && !isPeriodLabel(g.label)) {
      // пустая графа — просто мусор в книге, сообщать не о чем
      if (hasData(ws, layout, amountCol)) {
        warnings.push(`Графа «${g.label}» не похожа на период КС-2 — пропущена`);
      }
      continue;
    }

    const meta = fromBlock ?? parsePeriodLabel(g.label, g.monthHint);
    if (!g.label && !fromBlock) {
      warnings.push(`Графа ${amountCol}: колонка выполнения без подписи — номер КС-2 нужно указать вручную`);
    } else if (!meta.number) {
      warnings.push(`«${g.label || `графа ${amountCol}`}»: в файле нет номера КС-2 — укажите его в мастере`);
    }
    periods.push({ label: g.label, qtyCol, priceCol, amountCol, meta });
  }

  // справа от последнего подписанного акта в файлах обычно стоят заготовки будущих
  // периодов — без подписи и без данных; в портал они не нужны
  const lastLabeled = periods.reduce((acc, p, i) => (p.label ? i : acc), -1);
  const trimmed = lastLabeled >= 0 ? periods.slice(0, lastLabeled + 1) : periods;
  if (trimmed.length < periods.length) {
    warnings.push(
      `Пропущено ${periods.length - trimmed.length} пустых граф справа от последнего акта`,
    );
  }

  fillMonthYears(trimmed, opts.yearHint ?? null);
  return { periods: trimmed, controls, warnings };
}
