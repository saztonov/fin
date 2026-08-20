import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  RollbackOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Button, DatePicker, Form, Input, Modal, Popconfirm, Space, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadFile } from '../../api/client';
import type { Ks6Grid, PeriodInfo, Role } from '../../api/types';
import { useCreateKs2, useKs2Action } from '../../api/hooks';
import { fmtDate, fmtMoney, fmtMonth } from '../../shared/lib/formatters';
import { useFeedback } from '../../shared/lib/useFeedback';
import { StatusTag } from '../../shared/ui/StatusTag';

interface Props {
  objectId: string;
  grid: Ks6Grid;
  selectedKs2: string | null;
  onSelect: (id: string | null) => void;
  role: Role;
  hasUnsaved: boolean;
}

function chipLabel(p: PeriodInfo): string {
  if (p.periodFrom) return `КС-2 №${p.number} · ${fmtMonth(p.periodFrom)}`;
  return `КС-2 №${p.number}`;
}

export function Ks2Strip({ objectId, grid, selectedKs2, onSelect, role, hasUnsaved }: Props) {
  const { message, modal } = useFeedback();
  const navigate = useNavigate();
  const createKs2 = useCreateKs2(objectId);
  const ks2Action = useKs2Action(objectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const canManage = role === 'admin' || role === 'manager';
  const selected = grid.periods.find((p) => p.id === selectedKs2) ?? null;

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

  return (
    <Space wrap size={8} style={{ width: '100%' }}>
      <Space wrap size={4} style={{ flex: 1 }}>
        {grid.periods.map((p) => (
          <Button
            key={p.id}
            size="small"
            type={p.id === selectedKs2 ? 'primary' : 'default'}
            ghost={p.id === selectedKs2}
            onClick={() => onSelect(p.id === selectedKs2 ? null : p.id)}
          >
            <Space size={6}>
              {chipLabel(p)}
              <StatusTag status={p.status} compact />
            </Space>
          </Button>
        ))}
        {grid.periods.length === 0 ? <span style={{ color: '#8B94A3' }}>КС-2 ещё нет</span> : null}
      </Space>
      <Space size={8}>
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
      </Space>

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
          initialValues={{
            docDate: dayjs(),
            period: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
          }}
          onFinish={async (values: { number: string; docDate: Dayjs; period: [Dayjs, Dayjs] }) => {
            try {
              const created = await createKs2.mutateAsync({
                number: values.number,
                docDate: values.docDate?.format('YYYY-MM-DD') ?? null,
                periodFrom: values.period?.[0]?.format('YYYY-MM-DD') ?? null,
                periodTo: values.period?.[1]?.format('YYYY-MM-DD') ?? null,
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
