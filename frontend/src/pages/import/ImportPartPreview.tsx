import { Alert, Card, Checkbox, DatePicker, Input, Segmented, Space, Spin, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useImportPreview } from '../../api/hooks';
import type { ItemDiff, ItemDiffStatus } from '../../api/types';
import { fmtMoney } from '../../shared/lib/formatters';
import { MoneyText } from '../../shared/ui/MoneyText';
import { QtyText } from '../../shared/ui/QtyText';
import { StatusTag } from '../../shared/ui/StatusTag';

export interface PeriodDraft {
  index: number;
  number: string;
  periodFrom: string | null;
  periodTo: string | null;
  label: string | null;
  cellCount: number;
  totalAmount: string;
  existingDocStatus: string | null;
}

/** Всё, что пользователь настраивает для одной страницы книги. */
export interface PartApplyState {
  periods: PeriodDraft[];
  importHistory: boolean;
  applyChanged: boolean;
  overwriteKs2: boolean;
  /** предпросмотр загружен и параметры непротиворечивы */
  ready: boolean;
}

export const emptyPartState: PartApplyState = {
  periods: [],
  importHistory: true,
  applyChanged: false,
  overwriteKs2: false,
  ready: false,
};

function monthBounds(iso: string): { from: string; to: string } {
  const d = dayjs(iso);
  return { from: d.startOf('month').format('YYYY-MM-DD'), to: d.endOf('month').format('YYYY-MM-DD') };
}

interface Props {
  importId: string;
  enabled: boolean;
  isAdmin: boolean;
  state: PartApplyState;
  onChange: (next: PartApplyState) => void;
}

/**
 * Предпросмотр одной страницы книги: расхождения строк, периоды КС-2 и параметры
 * применения. Вынесен из мастера, потому что в режиме «две страницы КС» таких
 * панелей две — по одной на вкладку, и у каждой свои периоды и флаги.
 */
export function ImportPartPreview({ importId, enabled, isAdmin, state, onChange }: Props) {
  const preview = useImportPreview(importId, enabled);
  const [filter, setFilter] = useState<'all' | ItemDiffStatus>('all');

  // черновики реквизитов периодов из предпросмотра (+подстановка границ месяца)
  useEffect(() => {
    if (!preview.data) return;
    const periods = preview.data.ks2Columns.map((c) => {
      const bounds = !c.periodFrom && c.monthDate ? monthBounds(c.monthDate) : null;
      return {
        index: c.index,
        number: c.number ?? '',
        periodFrom: c.periodFrom ?? bounds?.from ?? null,
        periodTo: c.periodTo ?? bounds?.to ?? null,
        label: c.label,
        cellCount: c.cellCount,
        totalAmount: c.totalAmount,
        existingDocStatus: c.existingDocStatus,
      };
    });
    onChange({ ...state, periods, ready: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data]);

  if (!preview.data) return <Spin />;
  const data = preview.data;
  const filteredItems: ItemDiff[] = data.items.filter(
    (i) => filter === 'all' || i.status === filter,
  );
  const patch = (p: Partial<PartApplyState>) => onChange({ ...state, ...p });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {data.warnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`Предупреждения разбора (${data.warnings.length})`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflow: 'auto' }}>
              {data.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Card size="small" title="Контрольные суммы">
        <Space size={24} wrap>
          <span>
            Итого по смете (файл):{' '}
            <b className="num">{fmtMoney(data.controls.contractTotal) || '—'}</b>
          </span>
          <span>
            Σ номенклатур: <b className="num">{fmtMoney(data.controls.computedContractTotal)}</b>
          </span>
          {data.kind === 'ks6' ? (
            <span>
              Σ помесячных выполнений:{' '}
              <b className="num">{fmtMoney(data.controls.computedExecutedTotal)}</b>
            </span>
          ) : null}
        </Space>
      </Card>

      <Card
        size="small"
        title="Строки сметы"
        extra={
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            options={[
              { value: 'all', label: `Все (${data.items.length})` },
              { value: 'new', label: `Новые (${data.counts.new})` },
              { value: 'changed', label: `Изменённые (${data.counts.changed})` },
              { value: 'match', label: `Совпадают (${data.counts.match})` },
              { value: 'missing', label: `Нет в файле (${data.counts.missing})` },
            ]}
          />
        }
      >
        <Table<ItemDiff>
          size="small"
          rowKey={(r) => r.staged?.tmpId ?? r.existingId ?? Math.random().toString()}
          dataSource={filteredItems}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          columns={[
            {
              title: 'Статус',
              dataIndex: 'status',
              width: 110,
              render: (s: ItemDiffStatus) => <StatusTag status={s} compact />,
            },
            { title: 'Код КВР', width: 140, render: (_, r) => r.staged?.kvrCode ?? '' },
            {
              title: 'Наименование',
              ellipsis: true,
              render: (_, r) => r.staged?.name ?? r.existingName ?? '',
            },
            { title: 'Ед.', width: 70, render: (_, r) => r.staged?.unit ?? '' },
            {
              title: 'Кол-во',
              width: 100,
              align: 'right',
              render: (_, r) => <QtyText value={r.staged?.contractQty ?? null} />,
            },
            {
              title: 'Всего, ₽',
              width: 140,
              align: 'right',
              render: (_, r) => <MoneyText value={r.staged?.contractTotal ?? null} />,
            },
            {
              title: 'Изменения',
              width: 240,
              render: (_, r) =>
                r.changes ? (
                  <Space direction="vertical" size={0}>
                    {r.changes.map((c) => (
                      <Typography.Text key={c.field} style={{ fontSize: 12 }}>
                        {c.field}:{' '}
                        <Typography.Text delete type="secondary">
                          {fmtMoney(c.from)}
                        </Typography.Text>{' '}
                        → <b className="num">{fmtMoney(c.to)}</b>
                      </Typography.Text>
                    ))}
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>

      {data.kind === 'ks6' && state.periods.length > 0 ? (
        <Card size="small" title="Периоды КС-2 из файла">
          <Table<PeriodDraft>
            size="small"
            rowKey="index"
            dataSource={state.periods}
            pagination={false}
            columns={[
              {
                title: 'Подпись в файле',
                dataIndex: 'label',
                ellipsis: true,
                render: (v) => v ?? <Typography.Text type="secondary">без подписи</Typography.Text>,
              },
              {
                title: '№ КС-2',
                width: 120,
                render: (_, row) => (
                  <Input
                    size="small"
                    status={row.cellCount > 0 && !row.number.trim() ? 'error' : undefined}
                    value={row.number}
                    onChange={(e) =>
                      patch({
                        periods: state.periods.map((p) =>
                          p.index === row.index ? { ...p, number: e.target.value } : p,
                        ),
                      })
                    }
                  />
                ),
              },
              {
                title: 'Период',
                width: 260,
                render: (_, row) => (
                  <DatePicker.RangePicker
                    size="small"
                    format="DD.MM.YYYY"
                    value={[
                      row.periodFrom ? dayjs(row.periodFrom) : null,
                      row.periodTo ? dayjs(row.periodTo) : null,
                    ]}
                    onChange={(range) =>
                      patch({
                        periods: state.periods.map((p) =>
                          p.index === row.index
                            ? {
                                ...p,
                                periodFrom: range?.[0]?.format('YYYY-MM-DD') ?? null,
                                periodTo: range?.[1]?.format('YYYY-MM-DD') ?? null,
                              }
                            : p,
                        ),
                      })
                    }
                  />
                ),
              },
              { title: 'Строк', dataIndex: 'cellCount', width: 70, align: 'right' },
              {
                title: 'Сумма, ₽',
                dataIndex: 'totalAmount',
                width: 150,
                align: 'right',
                render: (v: string) => <MoneyText value={v} />,
              },
              {
                title: 'В портале',
                dataIndex: 'existingDocStatus',
                width: 110,
                render: (v: string | null) =>
                  v ? (
                    <StatusTag status={v as 'draft' | 'approved'} compact />
                  ) : (
                    <Typography.Text type="secondary">нет</Typography.Text>
                  ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Card size="small" title="Параметры применения">
        <Space direction="vertical" size={8}>
          {data.kind === 'ks6' ? (
            <Checkbox
              checked={state.importHistory}
              onChange={(e) => patch({ importHistory: e.target.checked })}
            >
              Импортировать историю выполнений (КС-2 создаются утверждёнными)
            </Checkbox>
          ) : null}
          {data.counts.changed > 0 ? (
            <Checkbox
              checked={state.applyChanged}
              onChange={(e) => patch({ applyChanged: e.target.checked })}
            >
              Применить изменения договорных значений по {data.counts.changed} совпавшим строкам
            </Checkbox>
          ) : null}
          {isAdmin && data.ks2Columns.some((c) => c.existingDocId) ? (
            <Checkbox
              checked={state.overwriteKs2}
              onChange={(e) => patch({ overwriteKs2: e.target.checked })}
            >
              Перезаписать строки существующих КС-2 с совпавшими номерами
            </Checkbox>
          ) : null}
        </Space>
      </Card>
    </Space>
  );
}

/** Можно ли применять эту страницу: у непустых колонок есть номера КС-2. */
export function partReady(state: PartApplyState): boolean {
  if (!state.ready) return false;
  if (!state.importHistory) return true;
  return state.periods.every((p) => p.cellCount === 0 || p.number.trim().length > 0);
}
