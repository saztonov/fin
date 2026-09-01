/**
 * Классификация строки таблицы: раздел, КВР, номенклатура, детализация «в т.ч.»
 * или контрольная строка «Итого».
 *
 * Источники истины перечислены по убыванию надёжности: явная колонка «Вид» (ЗИЛ),
 * явная колонка «Уровень N» (Примавера), точечный шифр «01.01.02.01» (Событие,
 * Сторис, Дом_56, Садовническая) и лишь затем эвристика «нет ед. изм. — значит
 * раздел». Эвристика подбора агрегатов по совпадению сумм (aggregate-pass)
 * применяется только там, где не сработал ни один из источников.
 */
import { normName } from './header-dictionary.js';

export type RowKind = 'section' | 'kvr' | 'nomenclature' | 'subline' | 'total';

export interface RowFacts {
  /** значение колонки «Вид», если она есть */
  kindText: string;
  /** значение колонки «Уровень», если она есть */
  levelText: string;
  /** № п/п и шифр — источники глубины «1.1.1» */
  posNo: string;
  code: string;
  /**
   * Роль строки в дереве точечных шифров: `node` — есть потомки (агрегат),
   * `leaf` — позиция. Заполняется, только когда вложенность подтверждена
   * арифметикой самого файла (см. code-hierarchy.ts); иначе `null`, и на
   * решение не влияет.
   */
  codeRole: 'node' | 'leaf' | null;
  name: string;
  unit: string;
  /** есть ли на листе графа «Ед. изм.» — от этого зависит признак позиции */
  unitColumnPresent: boolean;
  /** используется ли на листе графа «Вид» (есть строки КВР/Номенклатура) */
  kindColumnUsed: boolean;
  /** есть ли на листе явная разметка детализации («в т.ч.») */
  sublineMarkerUsed: boolean;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  bold: boolean;
}

export interface RowVerdict {
  kind: RowKind;
  /** глубина раздела (1 — верхний уровень); для позиций не используется */
  depth: number;
  /**
   * Источник решения. `kind-column` — «Вид» с распознанной пометкой (КВР,
   * Номенклатура, в т.ч.): единственный источник, который прямо отличает агрегат от
   * позиции. `kind-text` — «Вид» заполнен своим текстом («не в системе»): понятно,
   * что это строка сметы, но не понятно, агрегат ли она.
   */
  source: 'kind-column' | 'kind-text' | 'level-column' | 'code-tree' | 'code-depth' | 'shape';
}

const KIND_MAP: Record<string, RowKind> = {
  квр: 'kvr',
  номенклатура: 'nomenclature',
  'в т.ч.': 'subline',
  'в т.ч': 'subline',
  'в тч': 'subline',
  'в том числе': 'subline',
};

/**
 * «Итого», «Итого по разделу», «ВСЕГО по объекту», «НДС 20%», «БЕЗ НДС» —
 * контрольные строки. Под итогом документа они идут блоком (ЗИЛ: «НДС», «БЕЗ НДС»).
 */
export function isTotalRow(name: string): boolean {
  const s = normName(name);
  if (s.startsWith('итого') || s.startsWith('всего')) return true;
  if (/^(без|с|в т\.?\s?ч\.?)\s*ндс/.test(s)) return true;
  return s === 'ндс' || /^ндс[\s\d]/.test(s);
}

/**
 * Строка самого НДС («НДС 22%», «в т.ч. НДС 20 %»), а не итога, включающего НДС.
 * Нужна, чтобы `controls.vat` брал сумму налога, а не строку «ИТОГО, в т.ч. НДС»,
 * которая тоже содержит слово «НДС» и стоит рядом.
 */
export function isVatAmountRow(name: string): boolean {
  const s = normName(name);
  if (!s) return false;
  if (/^(итого|всего)/.test(s)) return false;
  return /^(в\s*т\.?\s*ч\.?\s*)?ндс([\s\d:,.]|$)/.test(s);
}

/**
 * Итог, в который НДС уже включён («ИТОГО, в т.ч. НДС 22%», «Всего с НДС»).
 * На листах, где графы идут без НДС, такой итог сверять со строками нельзя —
 * он на другой базе.
 */
export function isGrossTotalRow(name: string): boolean {
  if (!isTotalRow(name)) return false;
  const s = normName(name);
  return /(в\s*т\.?\s*ч\.?|с|включая|учетом)\s*ндс/.test(s);
}

/**
 * Итог всего документа («ИТОГО, руб. с НДС 20%», «Всего по Объекту»), а не итог
 * раздела («Итого по разделу 3»): после слова «Итого» не остаётся уточнения.
 */
export function isDocumentTotalRow(name: string): boolean {
  if (!isTotalRow(name)) return false;
  const rest = normName(name)
    .replace(/^(итого|всего)/, '')
    .replace(/по\s+(объекту|договору|смете)/g, '')
    .replace(/(руб(лей)?|с\s*ндс|без\s*ндс|в\s*т\.?\s*ч\.?\s*ндс|ндс|\d+\s*%)/g, '')
    .replace(/[\s.,:;-]/g, '');
  return rest === '';
}

/** Глубина по точечному номеру: «1.1.1.» → 3, «01.01.02.01» → 4. */
export function depthFromCode(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/[.\s]+$/, '');
  if (!s) return null;
  if (!/^\d+([.-]\d+)*$/.test(s)) return null;
  return s.split(/[.-]/).length;
}

/** «Уровень 5» → 5. */
export function depthFromLevel(raw: string): number | null {
  const m = /(\d+)/.exec(String(raw ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

/**
 * Похожа ли строка на позицию работ, а не на заголовок раздела.
 * Если графа «Ед. изм.» на листе есть — она и решает: разделы в реальных файлах
 * несут суммы в графах цены и итога, так что по деньгам их не отличить.
 */
function looksLikeItem(f: RowFacts): boolean {
  if (f.unitColumnPresent) return Boolean(f.unit);
  if (f.unitPrice !== null && f.unitPrice !== 0) return true;
  if (f.qty !== null && f.qty !== 0 && f.total !== null) return true;
  return false;
}

export function classifyRow(f: RowFacts): RowVerdict {
  if (isTotalRow(f.name)) return { kind: 'total', depth: 0, source: 'shape' };

  const kindKey = normName(f.kindText);
  const mapped = kindKey ? KIND_MAP[kindKey] : undefined;
  if (mapped) return { kind: mapped, depth: 0, source: 'kind-column' };

  if (kindKey) {
    // «Вид» заполнен чем-то своим («не в системе») — это всё равно строка сметы
    return { kind: 'nomenclature', depth: 0, source: 'kind-text' };
  }

  // «Вид» пуст. Если лист вообще размечает детализацию («в т.ч.»), то пустой «Вид»
  // у строки с ед. изм. — тоже детализация: считать её номенклатурой нельзя, суммы
  // задвоятся (ЗИЛ: 658 таких строк на 40 млрд). Если разметки детализации на листе
  // нет, это просто незаполненная графа у обычной строки (эталонный файл СУ-10).
  if (f.kindColumnUsed && f.sublineMarkerUsed && looksLikeItem(f)) {
    return { kind: 'subline', depth: 0, source: 'kind-column' };
  }

  const byLevel = depthFromLevel(f.levelText);
  if (byLevel !== null) {
    return looksLikeItem(f)
      ? { kind: 'nomenclature', depth: byLevel, source: 'level-column' }
      : { kind: 'section', depth: byLevel, source: 'level-column' };
  }

  // «позиции по смете» вида 1.1.1 информативнее сквозного «№ по порядку»
  const depths = [depthFromCode(f.code), depthFromCode(f.posNo)].filter(
    (d): d is number => d !== null,
  );
  const byCode = depths.length ? Math.max(...depths) : null;

  // Подтверждённая иерархия шифров главнее формы строки, и решает она в обе
  // стороны. Узел с потомками — агрегат, чем бы ни была заполнена его графа
  // «Ед. изм.»: разделы реальных книг несут «Компл» и «Кол-во 1» (Садовническая
  // 69), и без этого они попадают в номенклатуру и складываются вместе с детьми.
  // Лист — позиция, даже если ед. изм. пуста: «1.3.7 Разработка РД генплана по
  // ПЗУ» задана одним «Всего», и эвристика формы потеряла бы её сумму.
  if (f.codeRole === 'node') return { kind: 'section', depth: byCode ?? 0, source: 'code-tree' };
  if (f.codeRole === 'leaf') return { kind: 'nomenclature', depth: byCode ?? 0, source: 'code-tree' };

  if (looksLikeItem(f)) {
    return { kind: 'nomenclature', depth: byCode ?? 0, source: byCode ? 'code-depth' : 'shape' };
  }
  if (byCode !== null) return { kind: 'section', depth: byCode, source: 'code-depth' };
  // глубина неизвестна — её достроит парсер по текущему стеку разделов
  return { kind: 'section', depth: 0, source: 'shape' };
}
