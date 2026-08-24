import { ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Result, Skeleton, Space, Tabs, Typography } from 'antd';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useKs6Grid, useObjects, useSaveKs2Lines } from '../../api/hooks';
import type { PartCode, VatView } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useLocalStorageState } from '../../shared/lib/useLocalStorageState';
import { useFeedback } from '../../shared/lib/useFeedback';
import { EditsStore } from './ks6/editsStore';
import { Ks6Table } from './ks6/Ks6Table';
import { Ks2Strip } from './Ks2Strip';
import { ObjectPicker } from './ObjectPicker';
import { filterPeriods } from './periodFilter';

export function KsPage() {
  const { user } = useAuth();
  const { message } = useFeedback();
  const [params, setParams] = useSearchParams();
  const objectId = params.get('object');
  const selectedKs2 = params.get('ks2');
  const rangeFrom = params.get('from');
  const rangeTo = params.get('to');
  const partParam = params.get('part') as PartCode | null;

  // режим отображения сумм переживает перезагрузку: экономист работает то в одном,
  // то в другом, и каждый раз переключать его заново неудобно
  const [vatView, setVatView] = useLocalStorageState<VatView>('ks.vatView', 'gross');

  const objects = useObjects();
  const grid = useKs6Grid(objectId, vatView, partParam);
  const saveLines = useSaveKs2Lines(objectId);

  const storeRef = useRef(new EditsStore());
  const store = storeRef.current;
  const unsavedCount = useSyncExternalStore(store.subscribe, () => store.size());

  // смена объекта, вкладки или документа сбрасывает несохранённые правки
  useEffect(() => {
    store.clear();
  }, [objectId, selectedKs2, partParam, store]);

  // выбранный КС-2 живёт в своей части: при переключении вкладки чужой документ
  // из URL надо убрать, иначе колонка ввода «прилипнет» к другой смете
  useEffect(() => {
    if (!selectedKs2 || !grid.data) return;
    if (!grid.data.periods.some((p) => p.id === selectedKs2)) {
      const next = new URLSearchParams(params);
      next.delete('ks2');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.data, selectedKs2]);

  // guard: несохранённые изменения при закрытии вкладки
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (store.size() > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store]);

  const selectedDraft = useMemo(
    () => grid.data?.periods.find((p) => p.id === selectedKs2 && p.status === 'draft') ?? null,
    [grid.data, selectedKs2],
  );

  // фильтр по периоду — только набор колонок КС-2; итоги «Выполнено всего» и «Остаток»
  // считает бэкенд по всем утверждённым документам и фильтр их не затрагивает
  const visiblePeriods = useMemo(
    () => filterPeriods(grid.data?.periods ?? [], rangeFrom, rangeTo, selectedKs2),
    [grid.data, rangeFrom, rangeTo, selectedKs2],
  );

  const doSave = async () => {
    if (!selectedDraft || store.size() === 0) return;
    const lines = store.entries().map(([workItemId, qty]) => ({ workItemId, qty }));
    try {
      const res = await saveLines.mutateAsync({ id: selectedDraft.id, lines });
      store.clear();
      message.success(`Сохранено строк: ${res.saved}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // Ctrl+S — сохранить
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraft?.id, unsavedCount]);

  const setObject = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('object', id);
    else next.delete('object');
    next.delete('ks2');
    next.delete('from');
    next.delete('to');
    setParams(next, { replace: true });
  };

  const setKs2 = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('ks2', id);
    else next.delete('ks2');
    setParams(next, { replace: true });
  };

  const setPart = (code: string) => {
    const next = new URLSearchParams(params);
    next.set('part', code);
    next.delete('ks2');
    setParams(next, { replace: true });
  };

  const setRange = (from: string | null, to: string | null) => {
    const next = new URLSearchParams(params);
    if (from) next.set('from', from);
    else next.delete('from');
    if (to) next.set('to', to);
    else next.delete('to');
    setParams(next, { replace: true });
  };

  // автовыбора единственного объекта нет намеренно: с ним кнопка «К объектам»
  // тут же возвращала бы внутрь, и карточный экран был бы недостижим

  if (!objectId) {
    return <ObjectPicker role={user!.role} onOpen={setObject} />;
  }

  if (objects.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (objects.isError) {
    return (
      <Result
        status="error"
        title="Не удалось загрузить объекты"
        extra={<Button onClick={() => void objects.refetch()}>Повторить</Button>}
      />
    );
  }

  const current = objects.data?.find((o) => o.id === objectId);

  return (
    <div className="ks-page">
      <Space size={12} wrap>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setObject(null)}>
          К объектам
        </Button>
        <Typography.Text strong>
          {current ? `${current.code} — ${current.name}` : ''}
        </Typography.Text>
      </Space>

      {grid.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : grid.isError ? (
        <Result
          status="error"
          title="Не удалось загрузить КС-6"
          extra={<Button onClick={() => void grid.refetch()}>Повторить</Button>}
        />
      ) : grid.data ? (
        <>
          {grid.data.availableParts.length > 1 ? (
            <Tabs
              size="small"
              activeKey={grid.data.activePart?.code ?? undefined}
              onChange={setPart}
              style={{ marginBottom: -8 }}
              items={grid.data.availableParts.map((p) => ({ key: p.code, label: p.title }))}
            />
          ) : null}
          <Ks2Strip
            objectId={objectId}
            objectCode={objects.data?.find((o) => o.id === objectId)?.code ?? ''}
            grid={grid.data}
            selectedKs2={selectedKs2}
            onSelect={setKs2}
            role={user!.role}
            hasUnsaved={unsavedCount > 0}
            visibleCount={visiblePeriods.length}
            range={[rangeFrom, rangeTo]}
            onRangeChange={setRange}
            vatView={vatView}
            onVatViewChange={setVatView}
          />
          {unsavedCount > 0 && selectedDraft ? (
            <div className="dirty-bar">
              <span>
                Изменено ячеек: <b>{unsavedCount}</b> (КС-2 №{selectedDraft.number})
              </span>
              <Space style={{ marginLeft: 'auto' }}>
                <Button size="small" onClick={() => store.clear()}>
                  Отменить
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={saveLines.isPending}
                  onClick={() => void doSave()}
                >
                  Сохранить (Ctrl+S)
                </Button>
              </Space>
            </div>
          ) : null}
          {grid.data.rows.length <= 1 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 48 }}
              description="Структура сметы пуста"
            >
              {user?.role !== 'economist' ? (
                <Link to={`/ks/import?object=${objectId}`}>
                  <Button type="primary">Импортировать из Excel</Button>
                </Link>
              ) : (
                <Typography.Text type="secondary">
                  Структуру загружает руководитель или администратор
                </Typography.Text>
              )}
            </Empty>
          ) : (
            <div className="ks-page__table">
              {selectedKs2 && !selectedDraft ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  title="Выбранный КС-2 утверждён — колонка доступна только для чтения"
                />
              ) : null}
              {visiblePeriods.length === 0 && grid.data.periods.length > 0 ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  title="В выбранный период нет КС-2 — показаны только договорные колонки"
                />
              ) : null}
              <Ks6Table
                grid={grid.data}
                periods={visiblePeriods}
                selectedDraftId={selectedDraft?.id ?? null}
                editable={Boolean(selectedDraft)}
                store={store}
                vatView={vatView}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
