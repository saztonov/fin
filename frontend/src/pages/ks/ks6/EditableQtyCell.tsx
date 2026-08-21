import { InputNumber } from 'antd';
import { useSyncExternalStore } from 'react';
import { lineAmount, netFromGross } from '../../../shared/lib/money';
import type { EditsStore } from './editsStore';

interface Props {
  store: EditsStore;
  itemId: string;
  savedQty: string;
  precision: number;
  editIndex: number;
}

/**
 * Всегда смонтированный InputNumber (Excel-flow). Значение и dirty-состояние —
 * из EditsStore с точечной подпиской; stringMode сохраняет точность.
 */
export function EditableQtyCell({ store, itemId, savedQty, precision, editIndex }: Props) {
  const edited = useSyncExternalStore(store.subscribe, () => store.get(itemId));
  const dirty = edited !== undefined;
  const value = edited !== undefined ? edited : savedQty === '0' ? undefined : savedQty;

  return (
    <div className={dirty ? 'ks6-cell--dirty' : undefined}>
      <InputNumber<string>
        size="small"
        variant="filled"
        stringMode
        controls={false}
        min="0"
        precision={precision}
        decimalSeparator=","
        value={value ?? null}
        style={{ width: '100%' }}
        data-edit-index={editIndex}
        onChange={(v) => {
          const normalized = v === null || v === '' ? '0' : v;
          // возврат к сохранённому значению снимает пометку
          if (normalized === savedQty || (normalized === '0' && savedQty === '0')) {
            store.set(itemId, null);
          } else {
            store.set(itemId, normalized);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = e.key === 'ArrowUp' ? editIndex - 1 : editIndex + 1;
            const el = document.querySelector<HTMLInputElement>(
              `input[data-edit-index="${next}"]`,
            );
            el?.focus();
            el?.select();
          }
        }}
      />
    </div>
  );
}

/** Стоимость строки в редактируемой колонке: пересчёт от правки на лету. */
export function EditedAmountText({
  store,
  itemId,
  savedAmount,
  unitPriceGross,
  vatRate,
  render,
}: {
  store: EditsStore;
  itemId: string;
  savedAmount: string;
  /** цена как в договоре (с НДС) — сервер считает стоимость именно от неё */
  unitPriceGross: string;
  /** ставка для режима «без НДС»; 0 — показываем сумму как есть */
  vatRate: number;
  render: (amount: string) => React.ReactNode;
}) {
  const edited = useSyncExternalStore(store.subscribe, () => store.get(itemId));
  if (edited === undefined) return <>{render(savedAmount)}</>;
  // повторяем серверный порядок действий: сначала qty × цена с НДС до копеек, потом
  // выделение НДС. Иначе после сохранения ячейка «прыгала» бы на копейку
  const gross = lineAmount(edited, unitPriceGross);
  return <>{render(vatRate ? netFromGross(gross, vatRate) : gross)}</>;
}
