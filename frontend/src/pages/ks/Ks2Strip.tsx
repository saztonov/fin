import {
  CheckOutlined,
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilterOutlined,
  PlusOutlined,
  RollbackOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadFile } from '../../api/client';
import type { Ks6Grid, PartCode, PeriodInfo, Role, VatView } from '../../api/types';
import { useClearEstimate, useClearKs2, useCreateKs2, useKs2Action } from '../../api/hooks';
import { fmtDate, fmtMoney, fmtMonth } from '../../shared/lib/formatters';
import { useFeedback } from '../../shared/lib/useFeedback';
import { StatusTag } from '../../shared/ui/StatusTag';

interface Props {
  objectId: string;
  objectCode: string;
  grid: Ks6Grid;
  selectedKs2: string | null;
  onSelect: (id: string | null) => void;
  role: Role;
  hasUnsaved: boolean;
  /** сколько КС-2 сейчас показано в таблице (после фильтра по периоду) */
  visibleCount: number;
  range: [string | null, string | null];
  onRangeChange: (from: string | null, to: string | null) => void;
  vatView: VatView;
  onVatViewChange: (v: VatView) => void;
}

/**
 * Сумма выбранного КС-2 в трёх видах. НДС выделяется по ставке на дату периода
 * (20 % до 31.12.2025, 22 % с 01.01.2026), поэтому у каждого документа она своя.
 */
function Ks2Amounts({ p }: { p: PeriodInfo }) {
  return (
    <Typography.Text type="secondary">
      КС-2 №{p.number}: <b className="num">{fmtMoney(p.totalAmount)} ₽</b> с НДС · НДС {p.vatRate}%{' '}
      — <span className="num">{fmtMoney(p.vatAmount)} ₽</span> ·{' '}
      <span className="num">{fmtMoney(p.netAmount)} ₽</span> без НДС
    </Typography.Text>
  );
}

/**
 * Отчётный период по умолчанию — прошлый месяц, но в границах вкладки: во вкладке
 * «НДС 20%» месяц не может быть позже декабря 2025, во «НДС 22%» — раньше января
 * 2026. Иначе форма подставляла бы период, который сервер сразу отклонит.
 */
function defaultPeriod(part: PartCode | undefined): [Dayjs, Dayjs] {
  let month = dayjs().subtract(1, 'month');
  if (part === 'vat20' && month.isAfter(dayjs('2025-12-01'))) month = dayjs('2025-12-01');
  if (part === 'vat22' && month.isBefore(dayjs('2026-01-01'))) month = dayjs('2026-01-01');
  return [month.startOf('month'), month.endOf('month')];
}

function ks2Label(p: PeriodInfo): string {
  if (p.periodFrom) return `КС-2 №${p.number} · ${fmtMonth(p.periodFrom)}`;
  return `КС-2 №${p.number}`;
}

/** Панель управления КС-2: выбор документа для ввода, действия над ним и фильтр периода. */
export function Ks2Strip({
  objectId,
  objectCode,
  grid,
  selectedKs2,
  onSelect,
  role,
  hasUnsaved,
  visibleCount,
  range,
  onRangeChange,
  vatView,
  onVatViewChange,
}: Props) {
  const { message, modal } = useFeedback();
  const navigate = useNavigate();
  const createKs2 = useCreateKs2(objectId);
  const ks2Action = useKs2Action(objectId);
  const clearKs2 = useClearKs2(objectId);
  const clearEstimate = useClearEstimate(objectId);
  const [createOpen, setCreateOpen] = useState(false);
  // редкие действия (импорт/экспорт/очистка) свёрнуты: они нужны считаные разы,
  // а высоту грида съедали постоянно
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [form] = Form.useForm();

  const canManage = role === 'admin' || role === 'manager';
  const selected = grid.periods.find((p) => p.id === selectedKs2) ?? null;
  const filtered = Boolean(range[0] || range[1]);

  const approve = (p: PeriodInfo) => {
    modal.confirm({
      title: `Утвердить КС-2 №${p.number}?`,
      content: `Сумма документа: ${fmtMoney(p.totalAmount)} ₽. Данные войдут в накопительную ведомость КС-6, редактирование станет недоступно. Вернуть в черновик может руководитель или администратор.`,
      okText: 'Утвердить',
      cancelText: 'Отмена',
      autoFocusButton: 'cancel',
      onOk: async () => {
        await ks2Action.mutateAsync({ id: p.id, action: 'approve' });
        message.success(`КС-2 №${p.number} утверждён`);
      },
    });
  };

  const clearAll = () => {
    const approved = grid.periods.filter((p) => p.status === 'approved').length;
    let typed = '';
    modal.confirm({
      title: `Удалить все КС-2 по объекту ${objectCode}?`,
      width: 520,
      content: (
        <div>
          <p style={{ marginTop: 0 }}>
            Будет удалено документов: <b>{grid.periods.length}</b> (в т.ч. утверждённых:{' '}
            {approved}). Строки выполнения удаляются безвозвратно. Смета сохранится —
            после очистки историю можно загрузить заново из Excel.
          </p>
          <p style={{ marginBottom: 4 }}>
            Для подтверждения введите код объекта <b>{objectCode}</b>:
          </p>
          <Input
            placeholder={objectCode}
            autoFocus
            onChange={(e) => {
              typed = e.target.value;
            }}
          />
        </div>
      ),
      okText: 'Очистить',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      autoFocusButton: 'cancel',
      onOk: async () => {
        if (typed.trim().toLowerCase() !== objectCode.trim().toLowerCase()) {
          message.error('Код объекта введён неверно');
          return Promise.reject();
        }
        const res = await clearKs2.mutateAsync();
        onSelect(null);
        message.success(res.message);
      },
    });
  };

  const clearEstimateAll = () => {
    const approved = grid.periods.filter((p) => p.status === 'approved').length;
    let typed = '';
    modal.confirm({
      title: `Очистить смету объекта ${objectCode} полностью?`,
      width: 560,
      content: (
        <div>
          <p style={{ marginTop: 0 }}>
            Будут удалены <b>все строки сметы и разделы</b>, а вместе с ними —{' '}
            <b>{grid.periods.length}</b> КС-2 (в т.ч. утверждённых: {approved}) со строками
            выполнения. Иначе смету удалить нельзя: строки выполнения ссылаются на строки сметы.
          </p>
          <p style={{ marginBottom: 12 }}>
            Объект и журнал загруженных файлов сохранятся — после очистки книгу можно
            загрузить заново с нуля.
          </p>
          <p style={{ marginBottom: 4 }}>
            Для подтверждения введите код объекта <b>{objectCode}</b>:
          </p>
          <Input
            placeholder={objectCode}
            autoFocus
            onChange={(e) => {
              typed = e.target.value;
            }}
          />
        </div>
      ),
      okText: 'Очистить смету',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      autoFocusButton: 'cancel',
      onOk: async () => {
        if (typed.trim().toLowerCase() !== objectCode.trim().toLowerCase()) {
          message.error('Код объекта введён неверно');
          return Promise.reject();
        }
        const res = await clearEstimate.mutateAsync();
        onSelect(null);
        message.success(res.message);
      },
    });
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap size={8} style={{ width: '100%' }}>
        <Select
          showSearch
          allowClear
          size="small"
          style={{ width: 300 }}
          placeholder={grid.periods.length > 0 ? 'КС-2 для ввода объёмов' : 'КС-2 ещё нет'}
          disabled={grid.periods.length === 0}
          optionFilterProp="label"
          value={selectedKs2}
          onChange={(v) => onSelect(v ?? null)}
          options={grid.periods.map((p) => ({
            value: p.id,
            label: ks2Label(p),
            status: p.status,
          }))}
          optionRender={(option) => (
            <Space size={6}>
              {option.label}
              <StatusTag status={option.data.status} compact />
            </Space>
          )}
        />
        <Space wrap size={8}>
          {selected && selected.status === 'draft' && canManage ? (
            <Tooltip title={hasUnsaved ? 'Сначала сохраните изменения' : undefined}>
              <Button
                size="small"
                icon={<CheckOutlined />}
                disabled={hasUnsaved}
                onClick={() => approve(selected)}
              >
                Утвердить
              </Button>
            </Tooltip>
          ) : null}
          {selected && selected.status === 'approved' && canManage ? (
            <Popconfirm
              title={`Вернуть КС-2 №${selected.number} в черновик?`}
              okText="Вернуть"
              cancelText="Отмена"
              onConfirm={async () => {
                await ks2Action.mutateAsync({ id: selected.id, action: 'return' });
                message.success('Документ возвращён в черновик');
              }}
            >
              <Button size="small" icon={<RollbackOutlined />}>
                Вернуть
              </Button>
            </Popconfirm>
          ) : null}
          {selected && selected.status === 'draft' ? (
            <Popconfirm
              title={`Удалить черновик КС-2 №${selected.number}?`}
              okText="Удалить"
              okButtonProps={{ danger: true }}
              cancelText="Отмена"
              onConfirm={async () => {
                await ks2Action.mutateAsync({ id: selected.id, action: 'delete' });
                onSelect(null);
                message.success('Черновик удалён');
              }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ) : null}
          {selected ? (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => void downloadFile(`/ks2/${selected.id}/export.xlsx`)}
            >
              КС-2
            </Button>
          ) : null}
          <Button size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Новый КС-2
          </Button>
        </Space>

        <Space wrap size={8}>
          <Typography.Text type="secondary">Период:</Typography.Text>
          <DatePicker.RangePicker
            picker="month"
            size="small"
            format="MMM YYYY"
            allowClear
            allowEmpty={[true, true]}
            placeholder={['с месяца', 'по месяц']}
            value={[
              range[0] ? dayjs(range[0], 'YYYY-MM') : null,
              range[1] ? dayjs(range[1], 'YYYY-MM') : null,
            ]}
            onChange={(vals) =>
              onRangeChange(
                vals?.[0]?.format('YYYY-MM') ?? null,
                vals?.[1]?.format('YYYY-MM') ?? null,
              )
            }
            presets={[
              { label: 'Текущий год', value: [dayjs().startOf('year'), dayjs().endOf('year')] },
              {
                label: 'Прошлый год',
                value: [
                  dayjs().subtract(1, 'year').startOf('year'),
                  dayjs().subtract(1, 'year').endOf('year'),
                ],
              },
              { label: 'Последние 12 месяцев', value: [dayjs().subtract(11, 'month'), dayjs()] },
            ]}
          />
          {filtered ? (
            <Typography.Text type="secondary">
              Показано КС-2: {visibleCount} из {grid.periods.length}
            </Typography.Text>
          ) : null}
          <Tooltip
            title={
              grid.activePart?.vatRate
                ? `Пересчитывает все суммы таблицы по ставке вкладки — ${grid.activePart.vatRate}%`
                : 'Пересчитывает все суммы таблицы по ставке на дату периода'
            }
          >
            <Segmented
              size="small"
              value={vatView}
              onChange={(v) => onVatViewChange(v as VatView)}
              options={[
                { value: 'gross', label: 'с НДС' },
                { value: 'net', label: 'без НДС' },
              ]}
            />
          </Tooltip>
          <Tooltip title={extrasOpen ? 'Свернуть' : 'Импорт, экспорт и очистка'}>
            <Button
              size="small"
              type={extrasOpen ? 'primary' : 'text'}
              icon={<FilterOutlined />}
              aria-expanded={extrasOpen}
              onClick={() => setExtrasOpen((v) => !v)}
            >
              Фильтр
            </Button>
          </Tooltip>
        </Space>
      </Space>

      {/* grid-template-rows 0fr→1fr: height:auto не анимируется */}
      <div className={`ks-extras${extrasOpen ? ' ks-extras--open' : ''}`}>
        <div className="ks-extras__inner">
          <Space wrap size={8}>
            {selected ? (
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => void downloadFile(`/ks2/${selected.id}/export.xlsx`)}
              >
                Экспорт КС-2
              </Button>
            ) : null}
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => void downloadFile(`/objects/${objectId}/export/ks6.xlsx`)}
            >
              Экспорт КС-6
            </Button>
            {canManage ? (
              <Button
                size="small"
                icon={<UploadOutlined />}
                onClick={() => navigate(`/ks/import?object=${objectId}`)}
              >
                Импорт
              </Button>
            ) : null}
            {role === 'admin' && grid.periods.length > 0 ? (
              <Tooltip title="Удалить всю историю КС-2 по объекту — под повторную загрузку из Excel">
                <Button
                  size="small"
                  danger
                  icon={<ClearOutlined />}
                  loading={clearKs2.isPending}
                  onClick={clearAll}
                >
                  Очистить КС-2
                </Button>
              </Tooltip>
            ) : null}
            {role === 'admin' ? (
              <Tooltip title="Удалить строки сметы, разделы и всю историю КС-2 — под загрузку книги с нуля">
                <Button
                  size="small"
                  danger
                  icon={<ClearOutlined />}
                  loading={clearEstimate.isPending}
                  onClick={clearEstimateAll}
                >
                  Очистить смету
                </Button>
              </Tooltip>
            ) : null}
          </Space>
        </div>
      </div>

      {selected ? <Ks2Amounts p={selected} /> : null}

      <Modal
        title="Новый КС-2"
        open={createOpen}
        okText="Создать"
        cancelText="Отмена"
        confirmLoading={createKs2.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{ docDate: dayjs(), period: defaultPeriod(grid.activePart?.code) }}
          onFinish={async (values: { number: string; docDate: Dayjs; period: [Dayjs, Dayjs] }) => {
            try {
              const created = await createKs2.mutateAsync({
                number: values.number,
                docDate: values.docDate?.format('YYYY-MM-DD') ?? null,
                periodFrom: values.period?.[0]?.format('YYYY-MM-DD') ?? null,
                periodTo: values.period?.[1]?.format('YYYY-MM-DD') ?? null,
                // документ заводится в открытой вкладке: сервер проверит, что
                // период попадает в её границы по ставке НДС
                part: grid.activePart?.code ?? null,
              });
              setCreateOpen(false);
              onSelect(created.id);
              message.success(`Черновик КС-2 №${created.number} создан — вносите объёмы за период ${fmtDate(created.periodFrom)}–${fmtDate(created.periodTo)}`);
            } catch (e) {
              message.error((e as Error).message);
            }
          }}
        >
          <Form.Item
            name="number"
            label="Номер"
            rules={[{ required: true, message: 'Укажите номер КС-2' }]}
          >
            <Input placeholder="Например: 10" autoFocus />
          </Form.Item>
          <Form.Item name="docDate" label="Дата составления">
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="period"
            label="Отчётный период"
            rules={[{ required: true, message: 'Укажите период' }]}
          >
            <DatePicker.RangePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
