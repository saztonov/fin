const moneyFmt = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const qtyFmt = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/**
 * Расценка хранится с 6 знаками: в ведомостях заказчиков «1 234,5678 руб./м3» —
 * обычное дело. Показываем не меньше копеек и не больше того, что в ней есть.
 */
const priceFmt = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/**
 * Цена в режиме «без НДС»: там 6 знаков — артефакт деления на (100 + ставка),
 * а не то, что было в книге. Показываем копейки.
 */
const priceFmt2 = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return moneyFmt.format(n);
}

export function fmtPrice(
  value: string | number | null | undefined,
  precision: 2 | 6 = 6,
): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return (precision === 2 ? priceFmt2 : priceFmt).format(n);
}

export function fmtQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return qtyFmt.format(n);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «июл 2026» из ISO-даты. */
export function fmtMonth(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return '';
  return `${MONTHS[m - 1]} ${y}`;
}

/** Точность ввода объёма по единице измерения. */
export function qtyPrecision(unit: string): number {
  const u = unit.toLowerCase().replace(/\s/g, '');
  if (u === 'шт' || u === 'шт.') return 0;
  return 3;
}
