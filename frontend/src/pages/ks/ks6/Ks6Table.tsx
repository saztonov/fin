import { Table } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ks6Grid } from '../../../api/types';
import type { EditsStore } from './editsStore';
import { useKs6Columns } from './useKs6Columns';
import { useKs6Rows, type Ks6TableRow } from './useKs6Rows';

interface Props {
  grid: Ks6Grid;
  selectedDraftId: string | null;
  editable: boolean;
  store: EditsStore;
}

function rowClassName(row: Ks6TableRow): string {
  if (row.rowType === 'section') return `ks6-row--section-${Math.min(row.level, 3)}`;
  if (row.rowType === 'grandTotal') return 'ks6-row--grand-total';
  if (row.rowType === 'kvr') return 'ks6-row--kvr';
  return '';
}

export function Ks6Table({ grid, selectedDraftId, editable, store }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useKs6Rows(grid, collapsed);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(480);

  // высота тела таблицы = высота контейнера минус двухъярусная шапка
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setBodyHeight(Math.max(240, el.clientHeight - 96));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // сквозная нумерация редактируемых ячеек для клавиатурной навигации
  const editIndexByItem = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const row of rows) {
      if (row.rowType === 'nom' && row.itemId) map.set(row.itemId, i++);
    }
    return map;
  }, [rows]);

  const { columns, totalWidth } = useKs6Columns({
    periods: grid.periods,
    selectedDraftId,
    editable,
    store,
    editIndexByItem,
    onToggleSection: (id) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  });

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
      <Table<Ks6TableRow>
        className="ks6-table"
        virtual
        size="small"
        bordered={false}
        pagination={false}
        rowKey="key"
        columns={columns}
        dataSource={rows}
        scroll={{ x: totalWidth, y: bodyHeight }}
        rowClassName={rowClassName}
      />
    </div>
  );
}
