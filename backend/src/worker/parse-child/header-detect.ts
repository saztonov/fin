/**
 * Поиск шапки таблицы скорингом вместо жёсткой геометрии.
 *
 * В реальных книгах шапка занимает от одной до трёх строк, стоит на 3-й строке
 * (ЗИЛ) или на 46-й (Инджой), а обязательных «Код КВР»/«Вид» может не быть вовсе.
 * Поэтому перебираем окно строк и высоту блока, а выбираем вариант, в котором
 * распозналось больше всего логических полей.
 */
import { classifyGroup, classifyHeader, type HeaderField } from './header-dictionary.js';
import { cellText } from './sheet-utils.js';
import type { SheetGrid } from './xlsx-reader.js';

export interface ColumnTexts {
  /** самый нижний непустой текст в блоке шапки — собственно подпись графы */
  leaf: string;
  /** тексты вышестоящих строк блока (объединённые групповые заголовки) */
  context: string;
}

export interface HeaderLayout {
  headerRow: number;
  headerHeight: number;
  /** первая строка данных (строка «цифровой нумерации граф» пропущена) */
  dataStartRow: number;
  /** логическое поле → номер колонки */
  cols: Partial<Record<HeaderField, number>>;
  /** номер колонки → логическое поле (только договорный блок) */
  colField: Map<number, HeaderField>;
  /** последняя колонка договорного блока; периоды ищутся правее */
  lastContractCol: number;
  score: number;
}

const MAX_HEADER_SEARCH_ROW = 150;
const MAX_SCAN_COL = 400;

/** Веса полей: чем специфичнее заголовок, тем больше доверия строке-кандидату. */
const FIELD_WEIGHT: Partial<Record<HeaderField, number>> = {
  name: 4,
  unit: 3,
  qty: 2,
  unitPrice: 2,
  total: 2,
  posNo: 2,
  code: 2,
  kind: 3,
  level: 3,
  characteristic: 1,
  budgetArticle: 1,
  materialUnitPrice: 1,
  workUnitPrice: 1,
};

/** Ядро договорного блока: по нему определяется, где блок заканчивается. */
const CORE_FIELDS: HeaderField[] = [
  'posNo',
  'code',
  'kind',
  'level',
  'name',
  'characteristic',
  'budgetArticle',
  'unit',
  'qty',
  'unitPrice',
  'total',
];

/** Уточняющие графы (материалы/работы) — принимаются только рядом с ядром. */
const EXTRA_FIELDS: HeaderField[] = [
  'materialUnitPrice',
  'materialTotal',
  'workUnitPrice',
  'workTotal',
];

/** Насколько правее ядра ещё может стоять уточняющая графа договорного блока. */
const EXTRA_FIELD_REACH = 4;

export function composeColumnTexts(
  ws: SheetGrid,
  headerRow: number,
  height: number,
  maxCol: number,
): Map<number, ColumnTexts> {
  const out = new Map<number, ColumnTexts>();
  for (let c = 1; c <= maxCol; c++) {
    const seen: string[] = [];
    for (let r = headerRow; r < headerRow + height; r++) {
      const t = cellText(ws, r, c);
      if (t && !seen.includes(t)) seen.push(t);
    }
    if (!seen.length) continue;
    out.set(c, { leaf: seen[seen.length - 1]!, context: seen.slice(0, -1).join(' ') });
  }
  return out;
}

/**
 * Строка «1 2 3 4 …» под шапкой — нумерация граф, не данные.
 * Проверяется по договорному блоку: числа идут по возрастанию, длинных текстов нет
 * (короткие подписи вроде «Вид» в этой строке встречаются — ЗИЛ, лист ДС11).
 */
export function isGraphNumberRow(ws: SheetGrid, row: number, lastContractCol: number): boolean {
  const values: number[] = [];
  for (let c = 1; c <= Math.min(lastContractCol, 40); c++) {
    const t = cellText(ws, row, c);
    if (!t) continue;
    if (/^\d{1,2}$/.test(t)) values.push(Number(t));
    else if (t.length > 8) return false;
  }
  if (values.length < 3) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) return false;
  }
  return true;
}

function evaluate(ws: SheetGrid, headerRow: number, height: number, maxCol: number): HeaderLayout | null {
  const texts = composeColumnTexts(ws, headerRow, height, maxCol);
  const cols: Partial<Record<HeaderField, number>> = {};
  const colField = new Map<number, HeaderField>();
  let score = 0;

  const ordered = [...texts.entries()].sort((a, b) => a[0] - b[0]);
  const extras: [number, HeaderField][] = [];

  for (const [col, t] of ordered) {
    // «Стоимость … с начала строительства» / «Остаток» — контрольные графы,
    // они стоят внутри блоков выполнения и договорным полем быть не могут
    if (classifyGroup(t.leaf) === 'executed' || classifyGroup(t.leaf) === 'remainder') continue;
    const field = classifyHeader(t.leaf, t.context);
    if (!field) continue;
    if (EXTRA_FIELDS.includes(field)) {
      extras.push([col, field]);
      continue;
    }
    if (!CORE_FIELDS.includes(field)) continue;
    // первое вхождение поля — договорное; повторы правее относятся к периодам
    if (cols[field] !== undefined) continue;
    cols[field] = col;
    colField.set(col, field);
    score += FIELD_WEIGHT[field] ?? 1;
  }

  if (cols.name === undefined) return null;
  if (cols.unit === undefined && cols.qty === undefined && cols.total === undefined) return null;

  const coreLast = Math.max(...[...colField.keys()]);
  let lastContractCol = coreLast;
  for (const [col, field] of extras) {
    // «Ст-ть материала» встречается и в графах периодов — берём только соседей ядра
    if (col > coreLast + EXTRA_FIELD_REACH) continue;
    if (cols[field] !== undefined) continue;
    cols[field] = col;
    colField.set(col, field);
    score += FIELD_WEIGHT[field] ?? 1;
    if (col > lastContractCol) lastContractCol = col;
  }

  let dataStartRow = headerRow + height;
  if (isGraphNumberRow(ws, dataStartRow, lastContractCol)) dataStartRow += 1;

  // колонка «Уровень 1..7» бывает без заголовка — узнаём её по данным (Примавера)
  if (cols.level === undefined) {
    for (let c = 1; c <= Math.min(coreLast, maxCol); c++) {
      if (colField.has(c)) continue;
      let hits = 0;
      for (let r = dataStartRow; r <= Math.min(dataStartRow + 20, ws.rowCount); r++) {
        if (/^уровень\s*\d+$/i.test(cellText(ws, r, c))) hits += 1;
      }
      if (hits >= 3) {
        cols.level = c;
        colField.set(c, 'level');
        score += FIELD_WEIGHT.level ?? 1;
        break;
      }
    }
  }

  // «Вид» часто подписан не в шапке, а в строке нумерации граф под ней (ЗИЛ)
  if (cols.kind === undefined) {
    outer: for (let r = headerRow + height; r <= dataStartRow; r++) {
      for (let c = 1; c <= Math.min(lastContractCol + 2, maxCol); c++) {
        if (classifyHeader(cellText(ws, r, c)) !== 'kind') continue;
        cols.kind = c;
        colField.set(c, 'kind');
        score += FIELD_WEIGHT.kind ?? 1;
        if (dataStartRow <= r) dataStartRow = r + 1;
        break outer;
      }
    }
  }

  return { headerRow, headerHeight: height, dataStartRow, cols, colField, lastContractCol, score };
}

/**
 * Находит блок шапки. Возвращает null, если на листе не нашлось ничего похожего
 * на таблицу работ — вызывающий превращает это в понятную ошибку разбора.
 */
export function detectHeader(ws: SheetGrid): HeaderLayout | null {
  const maxCol = Math.min(ws.columnCount, MAX_SCAN_COL);
  const lastRow = Math.min(ws.rowCount, MAX_HEADER_SEARCH_ROW);
  let best: HeaderLayout | null = null;

  for (let r = 1; r <= lastRow; r++) {
    for (let h = 1; h <= 3; h++) {
      if (r + h - 1 > ws.rowCount) break;
      const candidate = evaluate(ws, r, h, maxCol);
      if (!candidate) continue;
      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.headerHeight < best.headerHeight)
      ) {
        best = candidate;
      }
    }
    // шапка найдена и следующие строки уже данные — дальше не ищем
    if (best && r > best.headerRow + 6) break;
  }

  return best;
}
