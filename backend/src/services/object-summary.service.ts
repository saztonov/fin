import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dec } from '../lib/money.js';

export interface ObjectSummary {
  id: string;
  code: string;
  name: string;
  address: string;
  hasContract: boolean;
  contractNumber: string | null;
  /** Σ номенклатур актуальной версии сметы — суммы с НДС, как в договоре */
  contractTotal: string;
  /** Σ строк утверждённых КС-2 этой же версии */
  executedAmount: string;
  remainderAmount: string;
  /** неудалённые КС-2 версии, включая черновики */
  ks2Count: number;
  /** подпись версии, если смета разделена по ставкам НДС; иначе null */
  partTitle: string | null;
  /** сумма по справочнику: договор + ДС */
  catalogAmount: string;
  /** справочник заполнен и не сходится со сметой (для разделённой сметы не считается) */
  catalogMismatch: boolean;
}

/**
 * Сводка по объектам для карточек стартового экрана.
 *
 * Две тонкости, обе проверены на реальных книгах.
 *
 * 1. Части сметы НЕ складываются. В `Сторис.xlsx` лист «КС6а 31.12.2025» несёт весь
 *    договор в ценах 20 % (6,95 млрд), а лист «КС6а ндс22%» — пересчёт оставшегося
 *    объёма по новой ставке (1,49 млрд). Сложение дало бы 8,44 млрд — сумму,
 *    которой нет ни в одном документе. Поэтому карточка показывает **актуальную
 *    версию** сметы (последняя часть по порядку вкладок) и подписывает её.
 * 2. Каждая метрика считается своим CTE и только потом присоединяется к объекту.
 *    Если сложить `work_items` и `ks2_lines` одним join'ом, сумма договора
 *    размножится на число строк выполнения.
 */
export async function getObjectSummaries(
  db: Db,
  objectIds: string[] | null,
): Promise<ObjectSummary[]> {
  // null — ограничений нет; пустой список означает «объектов не назначено»
  if (objectIds !== null && objectIds.length === 0) return [];
  const scope =
    objectIds === null
      ? sql``
      : sql` and o.id in (${sql.join(
          objectIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

  const res = await db.execute(sql`
    with cur as (
      -- актуальная версия сметы договора: legacy либо старшая из vat20/vat22
      select distinct on (contract_id) contract_id, id as part_id, code
      from estimate_parts
      order by contract_id, sort_order desc
    ),
    est as (
      select w.part_id, sum(w.contract_total) as total
      from work_items w
      where w.kind = 'nomenclature' and w.deleted_at is null
      group by w.part_id
    ),
    exe as (
      select d.part_id, sum(l.amount) as total
      from ks2_lines l
      join ks2_documents d on d.id = l.ks2_document_id
      join work_items wi on wi.id = l.work_item_id
      where d.status = 'approved' and d.deleted_at is null
        and wi.kind = 'nomenclature' and wi.deleted_at is null
      group by d.part_id
    ),
    docs as (
      select part_id, count(*) as cnt
      from ks2_documents where deleted_at is null
      group by part_id
    ),
    am as (
      select contract_id, sum(amount) as total
      from amendments where deleted_at is null
      group by contract_id
    ),
    split as (
      select contract_id, count(*) filter (where code <> 'legacy') > 0 as is_split
      from estimate_parts group by contract_id
    )
    select o.id, o.code, o.name, o.address,
           c.id as contract_id, c.number as contract_number,
           cur.code as part_code,
           coalesce(split.is_split, false) as is_split,
           coalesce(est.total, 0) as contract_total,
           coalesce(exe.total, 0) as executed_amount,
           coalesce(docs.cnt, 0) as ks2_count,
           coalesce(c.amount, 0) + coalesce(am.total, 0) as catalog_amount
    from construction_objects o
    left join contracts c on c.object_id = o.id and c.deleted_at is null
    left join cur   on cur.contract_id = c.id
    left join est   on est.part_id     = cur.part_id
    left join exe   on exe.part_id     = cur.part_id
    left join docs  on docs.part_id    = cur.part_id
    left join am    on am.contract_id  = c.id
    left join split on split.contract_id = c.id
    where o.deleted_at is null${scope}
    order by o.code
  `);

  const title: Record<string, string> = { vat20: 'НДС 20%', vat22: 'НДС 22%' };

  return (res.rows as Record<string, unknown>[]).map((r) => {
    const contractTotal = dec(r.contract_total as string).toFixed(2);
    const executedAmount = dec(r.executed_amount as string).toFixed(2);
    const catalogAmount = dec(r.catalog_amount as string).toFixed(2);
    const isSplit = Boolean(r.is_split);
    return {
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      address: (r.address as string) ?? '',
      hasContract: r.contract_id !== null,
      contractNumber: (r.contract_number as string | null) ?? null,
      contractTotal,
      executedAmount,
      remainderAmount: dec(contractTotal).sub(dec(executedAmount)).toFixed(2),
      ks2Count: Number(r.ks2_count ?? 0),
      partTitle: isSplit ? (title[r.part_code as string] ?? null) : null,
      catalogAmount,
      // как в гриде (ks6.service): пустой справочник поводом для тревоги не считаем,
      // а у разделённой сметы сравнивать справочник с одной её версией бессмысленно
      catalogMismatch:
        !isSplit && !dec(catalogAmount).isZero() && !dec(catalogAmount).eq(dec(contractTotal)),
    };
  });
}
