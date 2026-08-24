/**
 * Точное умножение «объём × цена» для предпросмотра стоимости в гриде.
 *
 * Считать это через Number нельзя: цена хранится с шестью знаками, и
 * `(Number(qty) * Number(price)).toFixed(2)` округляет по двоичной представимости —
 * на «половинке копейки» ячейка показала бы одно, а сервер после сохранения
 * (`lib/money.ts`, decimal half-up) вернул бы другое. Отдельной decimal-библиотеки
 * во фронтенде нет, поэтому масштабируем в целые и умножаем в BigInt.
 */

/** Строка «-12.3456» → { units: -123456n, scale: 4 }. Мусор даёт null. */
function parseScaled(v: string): { units: bigint; scale: number } | null {
  const s = v.trim().replace(',', '.');
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '-' || s === '.') return null;
  const negative = s.startsWith('-');
  const [int = '', frac = ''] = (negative ? s.slice(1) : s).split('.');
  const digits = `${int || '0'}${frac}`;
  const units = BigInt(digits);
  return { units: negative ? -units : units, scale: frac.length };
}

/** Стоимость строки: qty × price, округление до копеек half-up — как на сервере. */
export function lineAmount(qty: string, unitPrice: string): string {
  const a = parseScaled(qty);
  const b = parseScaled(unitPrice);
  if (!a || !b) return '0.00';

  const product = a.units * b.units;
  const scale = a.scale + b.scale;
  // приводим к сотым долям: масштаб произведения → 2 знака
  const shift = scale - 2;
  let kopecks: bigint;
  if (shift <= 0) {
    kopecks = product * 10n ** BigInt(-shift);
  } else {
    const divisor = 10n ** BigInt(shift);
    const abs = product < 0n ? -product : product;
    // half-up: половина уходит вверх по модулю, как в Excel и в round2 на сервере
    const rounded = (abs + divisor / 2n) / divisor;
    kopecks = product < 0n ? -rounded : rounded;
  }

  const negative = kopecks < 0n;
  const abs = (negative ? -kopecks : kopecks).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

/** Строка с двумя знаками из копеек. */
function fromKopecks(kopecks: bigint): string {
  const negative = kopecks < 0n;
  const abs = (negative ? -kopecks : kopecks).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

function toKopecks(amount: string): bigint | null {
  const parsed = parseScaled(amount);
  if (!parsed) return null;
  const shift = parsed.scale - 2;
  if (shift <= 0) return parsed.units * 10n ** BigInt(-shift);
  const divisor = 10n ** BigInt(shift);
  const abs = parsed.units < 0n ? -parsed.units : parsed.units;
  const rounded = (abs + divisor / 2n) / divisor;
  return parsed.units < 0n ? -rounded : rounded;
}

/**
 * Сумма без НДС — тем же способом, что и на сервере (`lib/money.ts`): выделить НДС
 * с округлением до копеек и вычесть. Ставка приходит с сервера вместе с периодом.
 * Нужно только для предпросмотра правки: сохранённые значения считает сервер.
 */
export function netFromGross(amount: string, rate: number): string {
  const kopecks = toKopecks(amount);
  if (kopecks === null) return '0.00';
  if (!rate) return fromKopecks(kopecks);

  const rateNum = BigInt(Math.round(rate * 100));
  const denominator = 10000n + rateNum;
  const abs = kopecks < 0n ? -kopecks : kopecks;
  const vatAbs = (abs * rateNum * 2n + denominator) / (denominator * 2n); // half-up
  const vat = kopecks < 0n ? -vatAbs : vatAbs;
  return fromKopecks(kopecks - vat);
}
