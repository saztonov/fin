import DecimalDefault from 'decimal.js-light';

/**
 * Единственная точка денежной арифметики и округления.
 * Значения ходят строками (PostgreSQL numeric), float не используется.
 * Округление half-up — как в Excel.
 */

// CJS-интероп под NodeNext: runtime-default = сам класс, типы берём из d.ts
type DecimalCtor = typeof import('decimal.js-light').Decimal;
const Decimal = DecimalDefault as unknown as DecimalCtor;
export type Dec = InstanceType<DecimalCtor>;

Decimal.set({ precision: 40 });

export type Num = string | number | Dec;

export function dec(v: Num | null | undefined): Dec {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v as string | number);
}

/** Округление до копеек (half-up). Возвращает строку с 2 знаками. */
export function round2(v: Num): string {
  return dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Округление количества до 6 знаков (как numeric(15,6)). */
export function roundQty(v: Num): string {
  return dec(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

/**
 * Цена за единицу до 6 знаков (как numeric(18,6)). В ведомостях заказчиков расценка
 * почти всегда с 4–6 знаками; урезание до копеек ломало бы qty × price при ручном вводе.
 */
export function round6(v: Num): string {
  return dec(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

/** Стоимость строки: объём × цена за единицу, до копеек. */
export function lineAmount(qty: Num, unitPrice: Num): string {
  return round2(dec(qty).mul(dec(unitPrice)));
}

export function add(...vals: (Num | null | undefined)[]): string {
  let acc = new Decimal(0);
  for (const v of vals) acc = acc.add(dec(v));
  return acc.toFixed(2);
}

export function sub(a: Num, b: Num): string {
  return dec(a).sub(dec(b)).toFixed(2);
}

export function sumStrings(vals: Iterable<string | null | undefined>): string {
  let acc = new Decimal(0);
  for (const v of vals) acc = acc.add(dec(v));
  return acc.toFixed(2);
}

/**
 * Ставки НДС по датам. Дублируют таблицу vat_rates, чтобы расчёт не требовал
 * похода в БД; при следующей смене ставки правится и миграция, и этот список.
 */
export const VAT_SCHEDULE: { from: string; rate: number }[] = [
  { from: '2019-01-01', rate: 20 },
  { from: '2026-01-01', rate: 22 },
];

/** Ставка НДС, действующая на дату (ISO). Без даты — текущая. */
export function vatRateOn(isoDate?: string | null): number {
  const on = isoDate && isoDate.length >= 10 ? isoDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  let rate = VAT_SCHEDULE[0]!.rate;
  for (const row of VAT_SCHEDULE) {
    if (on >= row.from) rate = row.rate;
  }
  return rate;
}

/**
 * НДС, выделенный из суммы с НДС: amount × rate / (100 + rate).
 * Ставка берётся по дате периода: до 31.12.2025 — 20%, с 01.01.2026 — 22%.
 * Для договоров без НДС (vat_mode = 'net') выделять нечего — вызывать не нужно.
 */
export function vatFromGross(amount: Num, onDate?: string | null): string {
  const rate = vatRateOn(onDate);
  return round2(dec(amount).mul(rate).div(100 + rate));
}

/**
 * Сумма без НДС = сумма с НДС − выделенный НДС. Именно вычитанием, а не
 * `amount × 100 / (100 + rate)`: так «без НДС» + «НДС» всегда дают исходную сумму
 * до копейки, и итог таблицы сходится со строками при любом округлении.
 */
export function netFromGross(amount: Num, onDate?: string | null): string {
  return sub(amount, vatFromGross(amount, onDate));
}

/**
 * Цена за единицу без НДС: здесь делением, а не вычитанием round2-НДС, — цена
 * хранится с 6 знаками, и копеечное округление промежуточного НДС испортило бы её.
 */
export function netPriceFromGross(price: Num, onDate?: string | null): string {
  const rate = vatRateOn(onDate);
  return round6(dec(price).mul(100).div(100 + rate));
}

export function isZero(v: Num | null | undefined): boolean {
  return dec(v).isZero();
}

export function isNegative(v: Num): boolean {
  return dec(v).isNegative();
}
