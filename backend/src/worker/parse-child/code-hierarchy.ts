/**
 * Иерархия строк по точечному шифру «№ п/п» («1» → «1.1.» → «1.1.1.» → листья).
 *
 * Зачем отдельный источник. Эвристика «нет ед. изм. — значит раздел»
 * (`looksLikeItem` в row-classify) ломается на книгах, где разделы несут
 * «Ед. изм. = Компл» и «Кол-во = 1»: раздел становится номенклатурой и
 * складывается вместе со своими детьми. На «Садовническая 69.xlsx» это давало
 * +797 млн к договору и до +93 млн на отдельной КС-2.
 *
 * Почему источнику можно верить. Правило самопроверяемое: иерархия применяется
 * только если её подтверждает арифметика самого файла — у внутренних узлов
 * «Всего» совпадает с суммой листьев-потомков. Там, где шифр означает что-то
 * другое (Инджой, Событие: 0 % и 42 % сходимости), правило не включается и
 * поведение остаётся прежним. Приоритет источников вида строки от этого не
 * меняется: явные графы «Вид» и «Уровень» по-прежнему главнее.
 */
import { dec } from '../../lib/money.js';
import { TOTALS_EPS } from './parsed-schema.js';
import { isTotalRow } from './row-classify.js';
import { cellDecimal, cellText } from './sheet-utils.js';
import type { HeaderLayout } from './header-detect.js';
import type { SheetGrid } from './xlsx-reader.js';

/** Минимум узлов, ниже которого совпадение сумм ничего не доказывает. */
const MIN_TRUST_NODES = 3;
/** Доля сошедшихся узлов, начиная с которой иерархия считается достоверной. */
const MIN_TRUST_SHARE = 0.9;

export interface CodeHierarchy {
  /** шифры, у которых есть строгие потомки, — агрегаты, а не позиции */
  parents: ReadonlySet<string>;
  /** номер строки листа → нормализованный шифр */
  codeByRow: ReadonlyMap<number, string>;
  /** подтвердила ли арифметика файла, что шифр действительно задаёт вложенность */
  trusted: boolean;
  /** узлов проверено / сошлось — для предупреждения в предпросмотре */
  nodes: number;
  matched: number;
}

export const EMPTY_HIERARCHY: CodeHierarchy = {
  parents: new Set(),
  codeByRow: new Map(),
  trusted: false,
  nodes: 0,
  matched: 0,
};

/**
 * «1.1.» → «1.1», «01.01.02.01» → «01.01.02.01», «1-2» → «1.2».
 * Разделители точка и дефис приводятся к точке, хвостовая пунктуация снимается.
 * Возвращает null, если это не шифр (сквозной счётчик «12» тоже шифр — просто
 * односегментный, родителем он ни для кого не станет).
 */
export function normalizeCode(raw: string): string | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/[.\s]+$/, '');
  if (!s) return null;
  if (!/^\d+([.-]\d+)*$/.test(s)) return null;
  return s.split(/[.-]/).join('.');
}

export function buildCodeHierarchy(ws: SheetGrid, layout: HeaderLayout): CodeHierarchy {
  const codeCols = [layout.cols.posNo, layout.cols.code].filter(
    (c): c is number => c !== undefined,
  );
  const nameCol = layout.cols.name;
  const totalCol = layout.cols.total;
  // без графы «Всего» проверить иерархию нечем — источник не применяем
  if (!codeCols.length || nameCol === undefined || totalCol === undefined) return EMPTY_HIERARCHY;

  const codeByRow = new Map<number, string>();
  const rowsByCode = new Map<string, number[]>();
  const totalByRow = new Map<number, string>();

  for (let r = layout.dataStartRow; r <= ws.rowCount; r++) {
    const name = cellText(ws, r, nameCol);
    if (!name || isTotalRow(name)) continue;
    let code: string | null = null;
    for (const c of codeCols) {
      code = normalizeCode(cellText(ws, r, c));
      if (code) break;
    }
    if (!code) continue;
    codeByRow.set(r, code);
    if (!rowsByCode.has(code)) rowsByCode.set(code, []);
    rowsByCode.get(code)!.push(r);
    totalByRow.set(r, cellDecimal(ws, r, totalCol) ?? '0');
  }

  if (codeByRow.size === 0) return EMPTY_HIERARCHY;

  // родитель — шифр, у которого есть строго более глубокий потомок. Проверяем по
  // префиксам самого шифра, а не перебором всех пар: на Инджое кодов 8 тысяч
  const codes = new Set(rowsByCode.keys());
  const parents = new Set<string>();
  for (const code of codes) {
    const segs = code.split('.');
    for (let i = 1; i < segs.length; i++) {
      const ancestor = segs.slice(0, i).join('.');
      if (codes.has(ancestor)) parents.add(ancestor);
    }
  }

  if (parents.size === 0) {
    return { parents, codeByRow, trusted: false, nodes: 0, matched: 0 };
  }

  // сумма листьев по каждому предку: один проход по листьям вместо
  // перебора «каждый родитель × каждый лист»
  const subtree = new Map<string, ReturnType<typeof dec>>();
  for (const [code, rows] of rowsByCode) {
    if (parents.has(code)) continue; // это узел, а не лист
    let leafSum = dec(0);
    for (const r of rows) leafSum = leafSum.add(dec(totalByRow.get(r) ?? '0'));
    const segs = code.split('.');
    for (let i = 1; i < segs.length; i++) {
      const ancestor = segs.slice(0, i).join('.');
      if (!codes.has(ancestor)) continue;
      subtree.set(ancestor, (subtree.get(ancestor) ?? dec(0)).add(leafSum));
    }
  }

  // ПРОВЕРКА: «Всего» узла == сумма листьев-потомков
  let nodes = 0;
  let matched = 0;
  for (const code of parents) {
    let nodeTotal = dec(0);
    for (const r of rowsByCode.get(code) ?? []) {
      nodeTotal = nodeTotal.add(dec(totalByRow.get(r) ?? '0'));
    }
    // узлы без суммы ничего не доказывают и не опровергают
    if (nodeTotal.lte(0)) continue;
    nodes += 1;
    const leaves = subtree.get(code) ?? dec(0);
    if (nodeTotal.sub(leaves).abs().lte(TOTALS_EPS)) matched += 1;
  }

  const trusted = nodes >= MIN_TRUST_NODES && matched / nodes >= MIN_TRUST_SHARE;
  return { parents, codeByRow, trusted, nodes, matched };
}

/**
 * Роль строки в дереве шифров — только когда иерархии можно верить.
 *
 * Решение симметрично в обе стороны, и это принципиально: сходимость сумм
 * проверялась именно на этом наборе листьев, значит и агрегаты, и позиции надо
 * брать из него целиком. Иначе лист без ед. изм. («1.3.7 Разработка РД генплана
 * по ПЗУ», только «Всего» = 1 500 000) старая эвристика формы объявит разделом,
 * и его сумма пропадёт.
 *
 * `null` — шифра нет или иерархия не подтверждена: решает прежняя логика.
 */
export function codeRole(h: CodeHierarchy, row: number): 'node' | 'leaf' | null {
  if (!h.trusted) return null;
  const code = h.codeByRow.get(row);
  if (code === undefined) return null;
  return h.parents.has(code) ? 'node' : 'leaf';
}
