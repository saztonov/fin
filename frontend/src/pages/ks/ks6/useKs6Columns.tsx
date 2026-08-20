import { CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import type { PeriodInfo } from '../../../api/types';
import { fmtDate, fmtMonth, qtyPrecision } from '../../../shared/lib/formatters';
import { MoneyText } from '../../../shared/ui/MoneyText';
import { QtyText } from '../../../shared/ui/QtyText';
import { StatusTag } from '../../../shared/ui/StatusTag';
import { EditableQtyCell, EditedAmountText } from './EditableQtyCell';
import type { EditsStore } from './editsStore';
import type { Ks6TableRow } from './useKs6Rows';

interface Options {
  periods: PeriodInfo[];
  selectedDraftId: string | null;
  editable: boolean;
  store: EditsStore;
  onToggleSection: (id: string) => void;
  editIndexByItem: Map<string, number>;
}

/** true → ячейку нужно перерисовать (строки иммутабельны, сравнение по ссылке). */
function cellChanged(a: Ks6TableRow, b: Ks6TableRow): boolean {
  return a !== b;
}

export function useKs6Columns({
  periods,
  selectedDraftId,
  editable,
  store,
  onToggleSection,
  editIndexByItem,
}: Options): { columns: ColumnsType<Ks6TableRow>; totalWidth: number } {
  return useMemo(() => {
    const nameColumn = {
      title: 'Наименование работ',
      key: 'name',
      width: 340,
      fixed: 'left' as const,
      ellipsis: true,
      shouldCellUpdate: cellChanged,
      render: (_: unknown, row: Ks6TableRow) => {
        if (row.rowType === 'section') {
          return (
            <span
              className="ks6-name"
              style={{ paddingLeft: (row.level - 1) * 16, cursor: 'pointer' }}
              onClick={() => onToggleSection(row.sectionId!)}
            >
              {row.collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
              {row.amendmentNumber ? (
                <StatusTag status="ds" label={`ДС №${row.amendmentNumber}`} compact />
              ) : null}
            </span>
          );
        }
        if (row.rowType === 'grandTotal') {
          return <span style={{ fontWeight: 600 }}>{row.name}</span>;
        }
        const indent = row.level * 16 + (row.rowType === 'nom' ? 16 : 0);
        const title = row.characteristic ? `${row.name}\n${row.characteristic}` : row.name;
        return (
          <span className="ks6-name" style={{ paddingLeft: indent }}>
            <Tooltip title={title} mouseEnterDelay={0.5}>
              <span
                className="ks6-name"
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  borderLeft: row.amendmentNumber ? '2px solid var(--ks-color-primary, #2F54EB)' : undefined,
                  paddingLeft: row.amendmentNumber ? 4 : undefined,
                }}
              >
                {row.name}
              </span>
            </Tooltip>
            {row.amendmentNumber ? (
              <StatusTag status="ds" label={`ДС №${row.amendmentNumber}`} compact />
            ) : null}
          </span>
        );
      },
    };

    const left: ColumnsType<Ks6TableRow> = [
      {
        title: '№',
        key: 'no',
        width: 48,
        fixed: 'left',
        align: 'right',
        shouldCellUpdate: cellChanged,
        render: (_, row) => (row.rowType === 'kvr' || row.rowType === 'nom' ? row.itemNo : null),
      },
      {
        title: 'Код КВР',
        key: 'kvrCode',
        width: 96,
        fixed: 'left',
        shouldCellUpdate: cellChanged,
        render: (_, row) => row.kvrCode ?? null,
      },
      nameColumn,
      {
        title: 'Ед. изм.',
        key: 'unit',
        width: 64,
        fixed: 'left',
        align: 'center',
        shouldCellUpdate: cellChanged,
        render: (_, row) => row.unit ?? null,
      },
    ];

    const contractGroup: ColumnsType<Ks6TableRow> = [
      {
        title: 'По договору',
        children: [
          {
            title: 'Кол-во',
            key: 'contractQty',
            width: 90,
            align: 'right',
            className: 'ks6-cell-num ks6-col--group-start',
            onHeaderCell: () => ({ className: 'ks6-col--group-start' }),
            shouldCellUpdate: cellChanged,
            render: (_, row) =>
              row.rowType === 'nom' || row.rowType === 'kvr' ? <QtyText value={row.contractQty} /> : null,
          },
          {
            title: 'Цена за ед.',
            key: 'unitPrice',
            width: 110,
            align: 'right',
            className: 'ks6-cell-num',
            shouldCellUpdate: cellChanged,
            render: (_, row) => (row.rowType === 'nom' ? <MoneyText value={row.unitPrice} /> : null),
          },
          {
            title: 'Всего',
            key: 'contractTotal',
            width: 130,
            align: 'right',
            className: 'ks6-cell-num',
            shouldCellUpdate: cellChanged,
            render: (_, row) => (
              <MoneyText
                value={row.contractTotal}
                strong={row.rowType === 'section' || row.rowType === 'grandTotal'}
                keepZero={row.rowType === 'grandTotal'}
              />
            ),
          },
        ],
      },
    ];

    const periodGroups: ColumnsType<Ks6TableRow> = periods.map((p) => {
      const isActiveDraft = editable && p.id === selectedDraftId && p.status === 'draft';
      const cellClass = `ks6-cell-num${isActiveDraft ? ' ks6-col--draft' : ''}`;
      const monthText = p.periodFrom
        ? `${fmtDate(p.periodFrom)}–${fmtDate(p.periodTo)}`
        : fmtMonth(p.periodFrom) || (p.importLabel ?? 'период не задан');
      return {
        key: `period-${p.id}`,
        title: (
          <div className={`ks6-period-head${isActiveDraft ? ' ks6-head--draft' : ''}`}>
            <span>КС-2 №{p.number}</span>
            <span className="muted">{monthText}</span>
            <StatusTag status={p.status} compact />
          </div>
        ),
        onHeaderCell: () => ({
          className: isActiveDraft ? 'ks6-head--draft' : undefined,
        }),
        children: [
          {
            title: 'Кол-во',
            key: `qty-${p.id}`,
            width: isActiveDraft ? 110 : 90,
            align: 'right' as const,
            className: `${cellClass} ks6-col--group-start`,
            onHeaderCell: () => ({ className: 'ks6-col--group-start' }),
            shouldCellUpdate: cellChanged,
            render: (_: unknown, row: Ks6TableRow) => {
              if (row.rowType === 'nom' && isActiveDraft) {
                return (
                  <EditableQtyCell
                    store={store}
                    itemId={row.itemId!}
                    savedQty={row.byPeriodQty[p.id] ?? '0'}
                    precision={qtyPrecision(row.unit ?? '')}
                    editIndex={editIndexByItem.get(row.itemId!) ?? -1}
                  />
                );
              }
              if (row.rowType === 'nom') return <QtyText value={row.byPeriodQty[p.id]} />;
              return null;
            },
          },
          {
            title: 'Стоимость',
            key: `amt-${p.id}`,
            width: 125,
            align: 'right' as const,
            className: cellClass,
            shouldCellUpdate: cellChanged,
            render: (_: unknown, row: Ks6TableRow) => {
              const strong = row.rowType === 'section' || row.rowType === 'grandTotal';
              const saved = row.byPeriodAmount[p.id];
              if (row.rowType === 'nom' && isActiveDraft) {
                return (
                  <EditedAmountText
                    store={store}
                    itemId={row.itemId!}
                    savedAmount={saved ?? '0'}
                    unitPrice={row.unitPrice ?? '0'}
                    render={(amount) => <MoneyText value={amount} />}
                  />
                );
              }
              return <MoneyText value={saved} strong={strong} />;
            },
          },
        ],
      };
    });

    const right: ColumnsType<Ks6TableRow> = [
      {
        title: 'Остаток',
        key: 'remainder',
        width: 135,
        align: 'right',
        className: 'ks6-cell-num ks6-col--group-start',
        onHeaderCell: () => ({ className: 'ks6-col--group-start' }),
        shouldCellUpdate: cellChanged,
        onCell: (row) => ({
          className:
            row.remainderAmount && Number(row.remainderAmount) < 0
              ? 'ks6-cell-num ks6-cell--negative'
              : 'ks6-cell-num',
        }),
        render: (_, row) => (
          <MoneyText
            value={row.remainderAmount}
            strong={row.rowType === 'section' || row.rowType === 'grandTotal'}
            markNegative
            keepZero={row.rowType === 'grandTotal'}
          />
        ),
      },
      {
        title: 'Выполнено всего',
        key: 'executed',
        width: 145,
        align: 'right',
        className: 'ks6-cell-num',
        shouldCellUpdate: cellChanged,
        render: (_, row) => (
          <MoneyText
            value={row.executedAmount}
            strong={row.rowType === 'section' || row.rowType === 'grandTotal'}
            keepZero={row.rowType === 'grandTotal'}
          />
        ),
      },
    ];

    const columns: ColumnsType<Ks6TableRow> = [...left, ...contractGroup, ...periodGroups, ...right];

    const totalWidth =
      48 + 96 + 340 + 64 + 90 + 110 + 130 + periods.reduce((acc, p) => acc + (editable && p.id === selectedDraftId ? 235 : 215), 0) + 135 + 145;

    return { columns, totalWidth };
  }, [periods, selectedDraftId, editable, store, onToggleSection, editIndexByItem]);
}
