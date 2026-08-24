import { InboxOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Progress,
  Radio,
  Result,
  Select,
  Space,
  Spin,
  Steps,
  Tabs,
  Typography,
  Upload,
} from 'antd';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useApplyImport,
  useApplyImportBatch,
  useImportPreview,
  useImportStatus,
  useObjects,
  useReparseImport,
  useSplitImport,
  useUploadImport,
} from '../../api/hooks';
import type { ApplyResult, ImportFileInfo, PartCode } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../shared/lib/useFeedback';
import {
  emptyPartState,
  ImportPartPreview,
  partReady,
  type PartApplyState,
} from './ImportPartPreview';

type Mode = 'single' | 'split';

const PART_LABEL: Record<PartCode, string> = {
  legacy: 'Смета',
  vat20: 'НДС 20%',
  vat22: 'НДС 22%',
};

export function ImportWizardPage() {
  const { user } = useAuth();
  const { message } = useFeedback();
  const [params] = useSearchParams();
  const objectId = params.get('object');

  const objects = useObjects();
  const upload = useUploadImport(objectId);
  const split = useSplitImport(objectId);
  const apply = useApplyImport(objectId);
  const applyBatch = useApplyImportBatch(objectId);

  const [kind, setKind] = useState<'ks6' | 'psdc'>('ks6');
  const [mode, setMode] = useState<Mode>('single');
  const [firstId, setFirstId] = useState<string | null>(null);
  const [secondId, setSecondId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PartCode>('vat20');
  const [result, setResult] = useState<ApplyResult | null>(null);

  // состояние применения по каждой странице отдельно: периоды и флаги у листов свои
  const [partStates, setPartStates] = useState<Record<string, PartApplyState>>({});
  const stateOf = (id: string) => partStates[id] ?? emptyPartState;
  const setStateOf = (id: string, next: PartApplyState) =>
    setPartStates((prev) => ({ ...prev, [id]: next }));

  const firstStatus = useImportStatus(firstId);
  const secondStatus = useImportStatus(secondId);
  const firstParsed = firstStatus.data?.status === 'parsed';
  const secondParsed = secondStatus.data?.status === 'parsed';

  const firstPreview = useImportPreview(firstId, firstParsed);
  const secondPreview = useImportPreview(secondId, secondParsed);

  const objectLabel = useMemo(() => {
    const o = objects.data?.find((x) => x.id === objectId);
    return o ? `${o.code} — ${o.name}` : '';
  }, [objects.data, objectId]);

  const reset = () => {
    setFirstId(null);
    setSecondId(null);
    setBatchId(null);
    setPartStates({});
  };

  if (!objectId) {
    return (
      <Result
        status="warning"
        title="Не выбран объект"
        extra={
          <Link to="/ks">
            <Button>К странице КС</Button>
          </Link>
        }
      />
    );
  }
  const failed = firstStatus.data?.status === 'parse_failed' || secondStatus.data?.status === 'parse_failed';

  // в режиме двух страниц шаг «Разбор» держит нас, пока не выбран второй лист
  const needSecondSheet = mode === 'split' && firstParsed && !secondId;
  const bothParsed = mode === 'single' ? firstParsed : firstParsed && secondParsed;
  const step = result ? 3 : bothParsed && !needSecondSheet ? 2 : firstId ? 1 : 0;

  const firstReady = firstPreview.data ? partReady(stateOf(firstId!)) : false;
  const secondReady = secondPreview.data ? partReady(stateOf(secondId!)) : false;
  const canApply = mode === 'single' ? firstReady : firstReady && secondReady;

  const applyInputFor = (id: string) => {
    const s = stateOf(id);
    return {
      importId: id,
      applyChanged: s.applyChanged,
      importHistory: kind === 'ks6' && s.importHistory,
      overwriteKs2: s.overwriteKs2,
      periods: s.periods
        .filter((p) => p.cellCount > 0)
        .map((p) => ({
          index: p.index,
          number: p.number.trim(),
          periodFrom: p.periodFrom,
          periodTo: p.periodTo,
        })),
    };
  };

  const doApply = async () => {
    try {
      const res =
        mode === 'split' && batchId
          ? await applyBatch.mutateAsync({
              batchId,
              parts: [applyInputFor(firstId!), applyInputFor(secondId!)],
            })
          : await apply.mutateAsync(applyInputFor(firstId!));
      setResult(res);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Импорт из Excel · {objectLabel}
      </Typography.Title>
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 16 }}
        items={[{ title: 'Файл' }, { title: 'Разбор' }, { title: 'Предпросмотр' }, { title: 'Готово' }]}
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
            <Radio.Group
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              options={[
                { value: 'single', label: 'Одна страница КС' },
                { value: 'split', label: 'Две страницы КС (НДС 20% и НДС 22%)' },
              ]}
            />
            <Typography.Text type="secondary">
              {mode === 'single'
                ? 'Одна таблица от начала объекта до конца.'
                : 'Первая таблица — по декабрь 2025 включительно (НДС 20%), вторая — с января 2026 (НДС 22%). Листы книги указываются после разбора; наборы строк у них могут отличаться.'}
            </Typography.Text>
            <Upload.Dragger
              accept=".xlsx"
              maxCount={1}
              showUploadList={false}
              customRequest={async ({ file }) => {
                try {
                  const created = await upload.mutateAsync({
                    file: file as File,
                    kind,
                    part: mode === 'split' ? 'vat20' : undefined,
                  });
                  setFirstId(created.id);
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
                Принимается только формат .xlsx (без макросов). Лист подбирается автоматически —
                после разбора его можно сменить.
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
              subTitle={firstStatus.data?.error ?? secondStatus.data?.error ?? 'Неизвестная ошибка'}
              extra={<Button onClick={reset}>Загрузить другой файл</Button>}
            />
          ) : needSecondSheet ? (
            <SecondSheetPicker
              firstStatus={firstStatus.data}
              loading={split.isPending}
              onPick={async (sheet) => {
                try {
                  const res = await split.mutateAsync({ importId: firstId!, sheet });
                  setSecondId(res.id);
                  setBatchId(res.batchId);
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}
              onCancel={reset}
            />
          ) : (
            <Space direction="vertical" align="center" style={{ width: '100%', padding: 24 }}>
              <Progress
                type="circle"
                percent={firstStatus.data?.status === 'parsing' ? 60 : 30}
                format={() => ''}
              />
              <Typography.Text type="secondary">
                Файл «{firstStatus.data?.originalName}» разбирается в фоновом режиме…
              </Typography.Text>
            </Space>
          )}
        </Card>
      ) : null}

      {step === 2 ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {mode === 'single' ? (
            <>
              <SheetPicker
                importId={firstId}
                objectId={objectId}
                usedSheet={firstStatus.data?.summary?.sheetName ?? firstStatus.data?.sheetName ?? null}
                candidates={firstStatus.data?.summary?.sheetCandidates ?? []}
                vat={firstStatus.data?.summary?.vat ?? null}
              />
              <ImportPartPreview
                importId={firstId!}
                enabled={firstParsed}
                isAdmin={user?.role === 'admin'}
                state={stateOf(firstId!)}
                onChange={(s) => setStateOf(firstId!, s)}
              />
            </>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                title="Две страницы КС"
                description="Каждая вкладка применяется в свою часть сметы. Импорт выполняется одной операцией: если вторая страница не пройдёт, первая тоже не применится."
              />
              <Tabs
                activeKey={activeTab}
                onChange={(k) => setActiveTab(k as PartCode)}
                items={[
                  {
                    key: 'vat20',
                    label: `${PART_LABEL.vat20}${firstReady ? '' : ' •'}`,
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <SheetPicker
                          importId={firstId}
                          objectId={objectId}
                          usedSheet={
                            firstStatus.data?.summary?.sheetName ?? firstStatus.data?.sheetName ?? null
                          }
                          candidates={firstStatus.data?.summary?.sheetCandidates ?? []}
                          vat={firstStatus.data?.summary?.vat ?? null}
                        />
                        <ImportPartPreview
                          importId={firstId!}
                          enabled={firstParsed}
                          isAdmin={user?.role === 'admin'}
                          state={stateOf(firstId!)}
                          onChange={(s) => setStateOf(firstId!, s)}
                        />
                      </Space>
                    ),
                  },
                  {
                    key: 'vat22',
                    label: `${PART_LABEL.vat22}${secondReady ? '' : ' •'}`,
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <SheetPicker
                          importId={secondId}
                          objectId={objectId}
                          usedSheet={
                            secondStatus.data?.summary?.sheetName ?? secondStatus.data?.sheetName ?? null
                          }
                          candidates={secondStatus.data?.summary?.sheetCandidates ?? []}
                          vat={secondStatus.data?.summary?.vat ?? null}
                        />
                        <ImportPartPreview
                          importId={secondId!}
                          enabled={secondParsed}
                          isAdmin={user?.role === 'admin'}
                          state={stateOf(secondId!)}
                          onChange={(s) => setStateOf(secondId!, s)}
                        />
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          )}

          <Space>
            <Button onClick={reset}>Загрузить другой файл</Button>
            <Button
              type="primary"
              disabled={!canApply}
              loading={apply.isPending || applyBatch.isPending}
              onClick={() => void doApply()}
            >
              Применить импорт
            </Button>
          </Space>
        </Space>
      ) : null}

      {step === 3 && result ? (
        <Result
          status="success"
          title="Импорт применён"
          subTitle={
            <Space direction="vertical" size={0}>
              <span>
                Разделов создано: {result.sectionsCreated}, строк создано: {result.itemsCreated},
                обновлено: {result.itemsUpdated}
              </span>
              <span>
                КС-2 создано: {result.ks2Created}, перезаписано: {result.ks2Overwritten}, пропущено:{' '}
                {result.ks2Skipped}, строк выполнения: {result.linesCreated}
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

/** Выбор листа для второй страницы: файл уже в хранилище, грузить заново не нужно. */
function SecondSheetPicker({
  firstStatus,
  loading,
  onPick,
  onCancel,
}: {
  firstStatus: ImportFileInfo | undefined;
  loading: boolean;
  onPick: (sheet: string) => void;
  onCancel: () => void;
}) {
  const [sheet, setSheet] = useState<string | null>(null);
  const used = firstStatus?.summary?.sheetName ?? firstStatus?.sheetName ?? null;
  const options = (firstStatus?.summary?.sheetCandidates ?? [])
    .filter((c) => c.name !== used)
    .map((c) => ({
      value: c.name,
      label:
        `${c.name}${c.state === 'visible' ? '' : ' (скрытый)'}` +
        (c.periods !== null ? ` — строк ${c.rows ?? 0}, периодов ${c.periods}` : ''),
    }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Text>
        Страница <b>{PART_LABEL.vat20}</b> прочитана с листа <b>{used ?? '—'}</b>. Укажите лист для
        страницы <b>{PART_LABEL.vat22}</b>:
      </Typography.Text>
      <Space wrap>
        <Select
          style={{ minWidth: 360 }}
          placeholder="Лист книги для НДС 22%"
          value={sheet}
          onChange={setSheet}
          options={options}
          notFoundContent="В книге нет другого подходящего листа"
        />
        <Button type="primary" disabled={!sheet} loading={loading} onClick={() => onPick(sheet!)}>
          Продолжить
        </Button>
        <Button onClick={onCancel}>Отмена</Button>
      </Space>
    </Space>
  );
}

interface SheetPickerProps {
  importId: string | null;
  objectId: string | null;
  usedSheet: string | null;
  candidates: {
    name: string;
    state: 'visible' | 'hidden' | 'veryHidden';
    score: number | null;
    rows: number | null;
    periods: number | null;
  }[];
  vat: { rate: number | null; mode: 'gross' | 'net' | null } | null;
}

/**
 * В книгах заказчиков листов несколько (две ставки НДС, КС-2 рядом с накопительной
 * ведомостью), поэтому выбранный лист показывается явно и его можно переключить,
 * не загружая файл заново.
 */
function SheetPicker({ importId, objectId, usedSheet, candidates, vat }: SheetPickerProps) {
  const reparse = useReparseImport(objectId);
  const { message } = useFeedback();
  const [sheet, setSheet] = useState<string | null>(null);
  const options = candidates.map((c) => ({
    value: c.name,
    label:
      `${c.name}${c.state === 'visible' ? '' : ' (скрытый)'}` +
      (c.periods !== null ? ` — строк ${c.rows ?? 0}, периодов ${c.periods}` : ''),
  }));

  return (
    <Card size="small" title="Лист книги">
      <Space wrap size={12}>
        <Typography.Text>
          Разобран лист: <Typography.Text strong>{usedSheet ?? '—'}</Typography.Text>
        </Typography.Text>
        {vat?.mode ? (
          <Typography.Text type="secondary">
            НДС в файле: {vat.mode === 'net' ? 'без НДС' : `${vat.rate ?? '—'}%`}
          </Typography.Text>
        ) : null}
        {options.length > 1 ? (
          <>
            <Select
              size="small"
              style={{ minWidth: 320 }}
              placeholder="Выбрать другой лист"
              value={sheet}
              onChange={setSheet}
              options={options}
            />
            <Button
              size="small"
              disabled={!sheet || sheet === usedSheet}
              loading={reparse.isPending}
              onClick={async () => {
                if (!importId || !sheet) return;
                try {
                  const res = await reparse.mutateAsync({ importId, sheet });
                  message.success(res.message);
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}
            >
              Перечитать
            </Button>
          </>
        ) : null}
      </Space>
    </Card>
  );
}
