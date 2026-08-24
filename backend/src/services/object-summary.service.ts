import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dec } from '../lib/money.js';

export interface ObjectSummary {
  id: string;
  code: string;
  name: string;
  address: string;
  /** Σ номенклатур актуальной версии сметы — суммы с НДС, как в книге */
  contractTotal: string;
  /** Σ строк утверждённых КС-2 этой же версии */
  executedAmount: string;
  remainderAmount: string;
  /** неудалённые КС-2 версии, включая черновики */
  ks2Count: number;
  /** подпись версии, если смета разделена по ставкам НДС; иначе null */
  partTitle: string | null;
}

/**
 * Сводка по объектам для карточек стартового экрана.
 *
 * Две тонкости, обе проверены на реальных книгах.
 *
 * 1. Части сметы НЕ складываются. В `Сторис.xlsx` лист «КС6а 31.12.2025» несёт всю
 *    смету в ценах 20 % (6,95 млрд), а лист «КС6а ндс22%» — пересчёт оставшегося
 *    объёма по новой ставке (1,49 млрд). Сложение дало бы 8,44 млрд — сумму,
 *    которой нет ни в одном документе. Поэтому карточка показывает **актуальную
 *    версию** сметы (последняя часть по порядку вкладок) и подписывает её.
 * 2. Каждая метрика считается своим CTE и только потом присоединяется к объекту.
 *    Если сложить `work_items` и `ks2_lines` одним join'ом, сумма сметы
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
      -- актуальная версия сметы объекта: legacy либо старшая из vat20/vat22
      select distinct on (object_id) object_id, id as part_id, code
      from estimate_parts
      order by object_id, sort_order desc
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
    split as (
      select object_id, count(*) filter (where code <> 'legacy') > 0 as is_split
      from estimate_parts group by object_id
    )
    select o.id, o.code, o.name, o.address,
           cur.code as part_code,
           coalesce(split.is_split, false) as is_split,
           coalesce(est.total, 0) as contract_total,
           coalesce(exe.total, 0) as executed_amount,
           coalesce(docs.cnt, 0) as ks2_count
    from construction_objects o
    left join cur   on cur.object_id = o.id
    left join est   on est.part_id   = cur.part_id
    left join exe   on exe.part_id   = cur.part_id
    left join docs  on docs.part_id  = cur.part_id
    left join split on split.object_id = o.id
    where o.deleted_at is null${scope}
    order by o.code
  `);

  const title: Record<string, string> = { vat20: 'НДС 20%', vat22: 'НДС 22%' };

  return (res.rows as Record<string, unknown>[]).map((r) => {
    const contractTotal = dec(r.contract_total as string).toFixed(2);
    const executedAmount = dec(r.executed_amount as string).toFixed(2);
    const isSplit = Boolean(r.is_split);
    return {
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      address: (r.address as string) ?? '',
      contractTotal,
      executedAmount,
      remainderAmount: dec(contractTotal).sub(dec(executedAmount)).toFixed(2),
      ks2Count: Number(r.ks2_count ?? 0),
      partTitle: isSplit ? (title[r.part_code as string] ?? null) : null,
    };
  });
}
