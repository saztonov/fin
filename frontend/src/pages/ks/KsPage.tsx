import { Alert, Button, Empty, Result, Select, Skeleton, Space, Typography } from 'antd';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useKs6Grid, useObjects, useSaveKs2Lines } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../shared/lib/useFeedback';
import { EditsStore } from './ks6/editsStore';
import { Ks6Table } from './ks6/Ks6Table';
import { Ks2Strip } from './Ks2Strip';
import { SummaryStats } from './SummaryStats';

export function KsPage() {
  const { user } = useAuth();
  const { message } = useFeedback();
  const [params, setParams] = useSearchParams();
  const objectId = params.get('object');
  const selectedKs2 = params.get('ks2');

  const objects = useObjects();
  const grid = useKs6Grid(objectId);
  const saveLines = useSaveKs2Lines(objectId);

  const storeRef = useRef(new EditsStore());
  const store = storeRef.current;
  const unsavedCount = useSyncExternalStore(store.subscribe, () => store.size());

  // смена объекта или документа сбрасывает несохранённые правки
  useEffect(() => {
    store.clear();
  }, [objectId, selectedKs2, store]);

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
    setParams(next, { replace: true });
  };

  const setKs2 = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('ks2', id);
    else next.delete('ks2');
    setParams(next, { replace: true });
  };

  // автовыбор единственного объекта
  useEffect(() => {
    if (!objectId && objects.data && objects.data.length === 1) {
      setObject(objects.data[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects.data, objectId]);

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

  if (!objectId) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            objects.data && objects.data.length > 0
              ? 'Выберите объект строительства'
              : 'Объекты строительства не заведены'
          }
        >
          {objects.data && objects.data.length > 0 ? (
            <Select
              showSearch
              placeholder="Объект строительства"
              style={{ width: 420 }}
              optionFilterProp="label"
              options={objects.data.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))}
              onChange={(v) => setObject(v)}
            />
          ) : user?.role !== 'economist' ? (
            <Link to="/refs">
              <Button type="primary">Добавить объект</Button>
            </Link>
          ) : (
            <Typography.Text type="secondary">
              Обратитесь к руководителю или администратору
            </Typography.Text>
          )}
        </Empty>
      </div>
    );
  }

  return (
    <div className="ks-page">
      <Space size={12} wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Select
          showSearch
          value={objectId}
          style={{ width: 420 }}
          optionFilterProp="label"
          options={(objects.data ?? []).map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))}
          onChange={(v) => setObject(v)}
        />
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
          <SummaryStats grid={grid.data} />
          <Ks2Strip
            objectId={objectId}
            grid={grid.data}
            selectedKs2={selectedKs2}
            onSelect={setKs2}
            role={user!.role}
            hasUnsaved={unsavedCount > 0}
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
          {!grid.data.contract ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 48 }}
              description="По объекту не заведён договор"
            >
              {user?.role !== 'economist' ? (
                <Link to="/refs?tab=contracts">
                  <Button type="primary">Заполнить договор</Button>
                </Link>
              ) : null}
            </Empty>
          ) : grid.data.rows.length <= 1 ? (
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
              <Ks6Table
                grid={grid.data}
                selectedDraftId={selectedDraft?.id ?? null}
                editable={Boolean(selectedDraft)}
                store={store}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
