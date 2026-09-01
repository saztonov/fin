import type { ParsedItem } from './parsed-schema.js';

const EPS = 0.05;

/**
 * В файлах встречаются агрегирующие строки, помеченные «Номенклатура»
 * (пример: «Прижимная стена» = сумма 7 строк ниже). Их учёт как обычных
 * номенклатур задваивает суммы. Правило: строка-номенклатура, чей «Всего»
 * равен сумме ≥2 следующих подряд номенклатур того же раздела, — агрегат:
 * переводится в kind='kvr', строки ниже привязываются к ней.
 *
 * Эвристика — источник последней очереди: `explicitKinds` содержит `tmpId` строк,
 * вид которых прямо указан в колонке «Вид», и такие строки она не трогает. Иначе
 * случайное совпадение сумм ломает разметку файла (ЗИЛ: «Устройство выравнивающей
 * стенки Корпус 1» = 2 × 987 799.67, и ровно столько же дают четыре строки ниже —
 * одинаковые расценки по корпусам).
 */
export function detectAggregates(
  items: ParsedItem[],
  warnings: string[],
  explicitKinds: ReadonlySet<string> = new Set(),
): void {
  // Однотипные срабатывания сворачиваются в одно предупреждение: на реальных книгах
  // их бывает под сотню, и в этом потоке тонет единственное важное сообщение —
  // расхождение Σ строк с «Итого» файла.
  const hits: { row: number; name: string; covered: number }[] = [];

  for (let i = 0; i < items.length; i++) {
    const head = items[i]!;
    if (head.kind !== 'nomenclature') continue;
    if (explicitKinds.has(head.tmpId)) continue;
    const target = Number(head.contractTotal);
    if (!(target > 0)) continue;
    let acc = 0;
    let covered = 0;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j]!;
      if (next.kind !== 'nomenclature' || next.sectionTmpId !== head.sectionTmpId) break;
      acc += Number(next.contractTotal);
      covered += 1;
      if (covered >= 2 && Math.abs(acc - target) <= EPS) {
        head.kind = 'kvr';
        head.kvrTmpId = null;
        for (let k = i + 1; k <= j; k++) items[k]!.kvrTmpId = head.tmpId;
        hits.push({ row: head.rowNumber, name: head.name, covered });
        break;
      }
      if (acc > target + EPS) break;
    }
  }

  if (hits.length === 1) {
    const h = hits[0]!;
    warnings.push(
      `Строка ${h.row}: «${h.name.slice(0, 50)}» распознана как агрегирующая (сумма ${h.covered} строк ниже) — учтена как КВР`,
    );
  } else if (hits.length > 1) {
    const rows = hits.slice(0, 10).map((h) => h.row).join(', ');
    const tail = hits.length > 10 ? ` и ещё ${hits.length - 10}` : '';
    warnings.push(
      `Распознано агрегирующих строк: ${hits.length} — учтены как КВР и в суммы не входят ` +
        `(строки ${rows}${tail})`,
    );
  }
}
