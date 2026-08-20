/**
 * Выбор листа книги.
 *
 * Раньше имя листа сравнивалось точно с «КС-6»/«ПСДЦ», из-за чего книги
 * заказчиков («КС6а», «КС-6_Осн.дог», «РСР_Часть1», «КС-2 №14») отвергались
 * целиком. Теперь лист либо указывает пользователь, либо он подбирается: сначала
 * по имени, затем по тому, нашлась ли на нём таблица работ.
 */
import { detectHeader } from './header-detect.js';
import { detectPeriodGroups } from './period-groups.js';
import type { SheetGrid, SheetInfo, SheetState, XlsxBook } from './xlsx-reader.js';

export interface SheetCandidate {
  name: string;
  state: SheetState;
  /** вес распознанной шапки; null — лист не читали */
  score: number | null;
  rows: number | null;
  periods: number | null;
}

const NAME_HINT = /(кс\s*-?\s*6|кс6|псдц|рср|ведомость)/i;
const MAX_SHEETS_TO_TRY = 4;

function order(sheets: SheetInfo[]): SheetInfo[] {
  const rank = (s: SheetInfo) =>
    (s.state === 'visible' ? 0 : 100) + (NAME_HINT.test(s.name) ? 0 : 10) + s.index / 1000;
  return [...sheets].sort((a, b) => rank(a) - rank(b));
}

export async function selectSheet(
  book: XlsxBook,
  requested?: string | null,
): Promise<{ ws: SheetGrid; candidates: SheetCandidate[] }> {
  const all = book.listSheets();
  const candidates: SheetCandidate[] = all.map((s) => ({
    name: s.name,
    state: s.state,
    score: null,
    rows: null,
    periods: null,
  }));
  const note = (ws: SheetGrid) => {
    const row = candidates.find((c) => c.name === ws.name);
    if (!row) return;
    row.rows = ws.rowCount;
    const layout = detectHeader(ws);
    row.score = layout?.score ?? 0;
    row.periods = layout ? detectPeriodGroups(ws, layout).periods.length : 0;
  };

  if (requested) {
    const ws = await book.readSheet(requested);
    note(ws);
    return { ws, candidates };
  }

  // читаем не больше нескольких кандидатов: у крупных книг чтение листа дорогое
  let best: { ws: SheetGrid; rank: number } | null = null;
  let read = 0;
  for (const info of order(all)) {
    if (read >= MAX_SHEETS_TO_TRY) break;
    const ws = await book.readSheet(info.name);
    read += 1;
    note(ws);
    const row = candidates.find((c) => c.name === ws.name);
    // периоды весомее: у «КС-2 №9» шапка не хуже, но это не накопительная ведомость
    const rank = (row?.score ?? 0) + (row?.periods ?? 0) * 10;
    if (!best || rank > best.rank) best = { ws, rank };
  }
  if (!best) throw new Error('В книге нет ни одного листа');
  return { ws: best.ws, candidates };
}
