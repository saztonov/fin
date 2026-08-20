import { InboxOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Input,
  Progress,
  Radio,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Typography,
  Upload,
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useApplyImport,
  useContract,
  useImportPreview,
  useImportStatus,
  useObjects,
  useUploadImport,
} from '../../api/hooks';
import type { ApplyResult, ItemDiff, ItemDiffStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { fmtMoney, fmtMonth } from '../../shared/lib/formatters';
import { useFeedback } from '../../shared/lib/useFeedback';
import { MoneyText } from '../../shared/ui/MoneyText';
import { QtyText } from '../../shared/ui/QtyText';
import { StatusTag } from '../../shared/ui/StatusTag';

interface PeriodDraft {
  index: number;
  number: string;
  periodFrom: string | null;
  periodTo: string | null;
  label: string | null;
  cellCount: number;
  totalAmount: string;
  existingDocStatus: string | null;
}

function monthBounds(iso: string): { from: string; to: string } {
  const d = dayjs(iso);
  return { from: d.startOf('month').format('YYYY-MM-DD'), to: d.endOf('month').format('YYYY-MM-DD') };
}

export function ImportWizardPage() {
  const { user } = useAuth();
  const { message } = useFeedback();
  const [params] = useSearchParams();
  const objectId = params.get('object');

  const objects = useObjects();
  const contract = useContract(objectId);
  const upload = useUploadImport(objectId);
  const [importId, setImportId] = useState<string | null>(null);
  const [kind, setKind] = useState<'ks6' | 'psdc'>('ks6');
  const status = useImportStatus(importId);
  const parsed = status.data?.status === 'parsed';
  const preview = useImportPreview(importId, parsed);
  const apply = useApplyImport(objectId);

  const [filter, setFilter] = useState<'all' | ItemDiffStatus>('all');
  const [periods, setPeriods] = useState<PeriodDraft[]>([]);
  const [importHistory, setImportHistory] = useState(true);
  const [applyChanged, setApplyChanged] = useState(false);
  const [overwriteKs2, setOverwriteKs2] = useState(false);
  const [amendmentId, setAmendmentId] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  // черновики реквизитов периодов из предпросмотра (+подстановка границ месяца)
  useEffect(() => {
    if (!preview.data) return;
    setPeriods(
      preview.data.ks2Columns.map((c) => {
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
      }),
    );
  }, [preview.data]);

  const objectLabel = useMemo(() => {
    const o = objects.data?.find((x) => x.id === objectId);
    return o ? `${o.code} — ${o.name}` : '';
  }, [objects.data, objectId]);

  if (!objectId) {
    return <Result status="warning" title="Не выбран объект" extra={<Link to="/ks"><Button>К странице КС</Button></Link>} />;
  }
  if (contract.data && !contract.data.contract) {
    return (
      <Result
        status="warning"
        title="По объекту не заведён договор"
        subTitle="Импорт привязывается к договору объекта. Сначала заполните договор в справочнике."
        extra={
          <Link to="/refs?tab=contracts">
            <Button type="primary">Заполнить договор</Button>
          </Link>
        }
      />
    );
  }

  const step = result ? 3 : parsed ? 2 : importId ? 1 : 0;
  const failed = status.data?.status === 'parse_failed';

  const filteredItems: ItemDiff[] =
    preview.data?.items.filter((i) => filter === 'all' || i.status === filter) ?? [];

  const canApply =
    Boolean(preview.data) &&
    (!preview.data!.amendmentRequired || Boolean(amendmentId)) &&
    (!importHistory || periods.every((p) => p.cellCount === 0 || p.number.trim().length > 0));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Импорт из Excel · {objectLabel}
      </Typography.Title>
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 16 }}
        items={[
          { title: 'Файл' },
          { title: 'Разбор' },
          { title: 'Предпросмотр' },
          { title: 'Готово' },
        ]}
      />

      {step === 0 ? (
        <Card>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Radio.Group
              value={kind}
              onChange={(e) => setKind(e.target.value as 'ks6' | 'psdc')}
              options={[
                { value: 'ks6', label: 'КС-6 (структура + история выполнений)' },
                { value: 'psdc', label: 'ПСДЦ (только структура и договорные данные)' },
              ]}
            />
            <Upload.Dragger
              accept=".xlsx"
              maxCount={1}
              showUploadList={false}
              customRequest={async ({ file }) => {
                try {
                  const created = await upload.mutateAsync({ file: file as File, kind });
                  setImportId(created.id);
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Перетащите файл .xlsx или нажмите для выбора</p>
              <p className="ant-upload-hint">
                Принимается только формат .xlsx (без макросов). Лист «{kind === 'ks6' ? 'КС-6' : 'ПСДЦ'}» должен быть видимым.
              </p>
            </Upload.Dragger>
            {upload.isPending ? <Spin /> : null}
          </Space>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          {failed ? (
            <Result
              status="error"
              title="Файл не разобран"
              subTitle={status.data?.error ?? 'Неизвестная ошибка'}
              extra={
                <Button
                  onClick={() => {
                    setImportId(null);
                  }}
                >
                  Загрузить другой файл
                </Button>
              }
            />
          ) : (
            <Space direction="vertical" align="center" style={{ width: '100%', padding: 24 }}>
              <Progress type="circle" percent={status.data?.status === 'parsing' ? 60 : 30} format={() => ''} />
              <Typography.Text type="secondary">
                Файл «{status.data?.originalName}» разбирается в фоновом режиме…
              </Typography.Text>
            </Space>
          )}
        </Card>
      ) : null}

      {step === 2 && preview.data ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {preview.data.warnings.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              title={`Предупреждения разбора (${preview.data.warnings.length})`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflow: 'auto' }}>
                  {preview.data.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          <Card size="small" title="Контрольные суммы">
            <Space size={24} wrap>
              <span>
                Итого по договору (файл):{' '}
                <b className="num">{fmtMoney(preview.data.controls.contractTotal) || '—'}</b>
              </span>
              <span>
                Σ номенклатур: <b className="num">{fmtMoney(preview.data.controls.computedContractTotal)}</b>
              </span>
              {preview.data.kind === 'ks6' ? (
                <span>
                  Σ помесячных выполнений:{' '}
                  <b className="num">{fmtMoney(preview.data.controls.computedExecutedTotal)}</b>
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
                  { value: 'all', label: `Все (${preview.data.items.length})` },
                  { value: 'new', label: `Новые (${preview.data.counts.new})` },
                  { value: 'changed', label: `Изменённые (${preview.data.counts.changed})` },
                  { value: 'match', label: `Совпадают (${preview.data.counts.match})` },
                  { value: 'missing', label: `Нет в файле (${preview.data.counts.missing})` },
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
                            {c.field}: <Typography.Text delete type="secondary">{fmtMoney(c.from)}</Typography.Text>{' '}
                            → <b className="num">{fmtMoney(c.to)}</b>
                          </Typography.Text>
                        ))}
                      </Space>
                    ) : null,
                },
              ]}
            />
          </Card>

          {preview.data.kind === 'ks6' && periods.length > 0 ? (
            <Card size="small" title="Периоды КС-2 из файла">
              <Table<PeriodDraft>
                size="small"
                rowKey="index"
                dataSource={periods}
                pagination={false}
                columns={[
                  { title: 'Подпись в файле', dataIndex: 'label', ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">без подписи</Typography.Text> },
                  {
                    title: '№ КС-2',
                    width: 120,
                    render: (_, row) => (
                      <Input
                        size="small"
                        status={row.cellCount > 0 && !row.number.trim() ? 'error' : undefined}
                        value={row.number}
                        onChange={(e) =>
                          setPeriods((prev) =>
                            prev.map((p) => (p.index === row.index ? { ...p, number: e.target.value } : p)),
                          )
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
                          setPeriods((prev) =>
                            prev.map((p) =>
                              p.index === row.index
                                ? {
                                    ...p,
                                    periodFrom: range?.[0]?.format('YYYY-MM-DD') ?? null,
                                    periodTo: range?.[1]?.format('YYYY-MM-DD') ?? null,
                                  }
                                : p,
                            ),
                          )
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
                      v ? <StatusTag status={v as 'draft' | 'approved'} compact /> : <Typography.Text type="secondary">нет</Typography.Text>,
                  },
                ]}
              />
            </Card>
          ) : null}

          <Card size="small" title="Параметры применения">
            <Space direction="vertical" size={8}>
              {preview.data.kind === 'ks6' ? (
                <Checkbox checked={importHistory} onChange={(e) => setImportHistory(e.target.checked)}>
                  Импортировать историю выполнений (КС-2 создаются утверждёнными)
                </Checkbox>
              ) : null}
              {preview.data.counts.changed > 0 ? (
                <Checkbox checked={applyChanged} onChange={(e) => setApplyChanged(e.target.checked)}>
                  Применить изменения договорных значений по {preview.data.counts.changed} совпавшим строкам
                </Checkbox>
              ) : null}
              {user?.role === 'admin' && preview.data.ks2Columns.some((c) => c.existingDocId) ? (
                <Checkbox checked={overwriteKs2} onChange={(e) => setOverwriteKs2(e.target.checked)}>
                  Перезаписать строки существующих КС-2 с совпавшими номерами
                </Checkbox>
              ) : null}
              {preview.data.amendmentRequired ? (
                <Space>
                  <Typography.Text>Новые строки добавляются по ДС:</Typography.Text>
                  <Select
                    style={{ width: 280 }}
                    placeholder="Выберите доп. соглашение"
                    status={!amendmentId ? 'error' : undefined}
                    value={amendmentId}
                    options={(contract.data?.amendments ?? []).map((a) => ({
                      value: a.id,
                      label: `ДС №${a.number}${a.dateSigned ? ` от ${dayjs(a.dateSigned).format('DD.MM.YYYY')}` : ''}`,
                    }))}
                    onChange={setAmendmentId}
                  />
                </Space>
              ) : null}
            </Space>
          </Card>

          <Space>
            <Button onClick={() => setImportId(null)}>Загрузить другой файл</Button>
            <Button
              type="primary"
              disabled={!canApply}
              loading={apply.isPending}
              onClick={async () => {
                try {
                  const res = await apply.mutateAsync({
                    importId: importId!,
                    amendmentId,
                    applyChanged,
                    importHistory: preview.data!.kind === 'ks6' && importHistory,
                    overwriteKs2,
                    periods: periods
                      .filter((p) => p.cellCount > 0)
                      .map((p) => ({
                        index: p.index,
                        number: p.number.trim(),
                        periodFrom: p.periodFrom,
                        periodTo: p.periodTo,
                      })),
                  });
                  setResult(res);
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}
            >
              Применить импорт
            </Button>
          </Space>
        </Space>
      ) : null}
      {step === 2 && !preview.data ? <Spin /> : null}

      {step === 3 && result ? (
        <Result
          status="success"
          title="Импорт применён"
          subTitle={
            <Space direction="vertical" size={0}>
              <span>Разделов создано: {result.sectionsCreated}, строк создано: {result.itemsCreated}, обновлено: {result.itemsUpdated}</span>
              <span>
                КС-2 создано: {result.ks2Created}, перезаписано: {result.ks2Overwritten}, пропущено: {result.ks2Skipped}, строк выполнения: {result.linesCreated}
              </span>
            </Space>
          }
          extra={
            <Link to={`/ks?object=${objectId}`}>
              <Button type="primary">Открыть КС-6</Button>
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
