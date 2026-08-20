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

/** НДС 20%, выделенный из суммы с НДС: amount × 20 / 120. */
export function vatFromGross(amount: Num): string {
  return round2(dec(amount).mul(20).div(120));
}

export function isZero(v: Num | null | undefined): boolean {
  return dec(v).isZero();
}

export function isNegative(v: Num): boolean {
  return dec(v).isNegative();
}
