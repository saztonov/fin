import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import {
  useContract,
  useDeleteAmendment,
  useObjects,
  useSaveAmendment,
  useSaveContract,
} from '../../api/hooks';
import type { Amendment } from '../../api/types';
import { fmtDate, fmtMoney } from '../../shared/lib/formatters';
import { useFeedback } from '../../shared/lib/useFeedback';
import { MoneyText } from '../../shared/ui/MoneyText';

const toIso = (d: Dayjs | null | undefined) => (d ? d.format('YYYY-MM-DD') : null);
const fromIso = (s: string | null | undefined) => (s ? dayjs(s) : null);

export function ContractsTab() {
  const { message } = useFeedback();
  const objects = useObjects();
  const [objectId, setObjectId] = useState<string | null>(null);
  const contractQ = useContract(objectId);
  const saveContract = useSaveContract(objectId);
  const saveAmendment = useSaveAmendment(objectId);
  const deleteAmendment = useDeleteAmendment(objectId);

  const [contractOpen, setContractOpen] = useState(false);
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [editingAmendment, setEditingAmendment] = useState<Amendment | null>(null);
  const [contractForm] = Form.useForm();
  const [amendmentForm] = Form.useForm();

  const contract = contractQ.data?.contract ?? null;
  const amendments = contractQ.data?.amendments ?? [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Select
        showSearch
        placeholder="Объект строительства"
        style={{ width: 420 }}
        optionFilterProp="label"
        value={objectId}
        options={(objects.data ?? []).map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))}
        onChange={setObjectId}
      />

      {!objectId ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Выберите объект" />
      ) : (
        <>
          <Card
            title="Договор"
            size="small"
            extra={
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  contractForm.setFieldsValue(
                    contract
                      ? {
                          ...contract,
                          dateSigned: fromIso(contract.dateSigned),
                          zosDate: fromIso(contract.zosDate),
                        }
                      : { number: '', amount: '0', customerName: '', contractorName: '', subject: '' },
                  );
                  setContractOpen(true);
                }}
              >
                {contract ? 'Изменить' : 'Заполнить'}
              </Button>
            }
          >
            {contract ? (
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Номер">{contract.number}</Descriptions.Item>
                <Descriptions.Item label="Сумма, ₽">
                  <MoneyText value={contract.amount} keepZero />
                </Descriptions.Item>
                <Descriptions.Item label="Дата подписания">
                  {fmtDate(contract.dateSigned) || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Дата ЗОС">{fmtDate(contract.zosDate) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Заказчик" span={2}>
                  {contract.customerName || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Генподрядчик" span={2}>
                  {contract.contractorName || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Предмет (стройка)" span={2}>
                  {contract.subject || '—'}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Договор не заведён" />
            )}
          </Card>

          {contract ? (
            <Card
              title="Дополнительные соглашения"
              size="small"
              extra={
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingAmendment(null);
                    amendmentForm.resetFields();
                    setAmendmentOpen(true);
                  }}
                >
                  Добавить ДС
                </Button>
              }
            >
              <Table<Amendment>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={amendments}
                locale={{
                  emptyText: (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ДС нет" />
                  ),
                }}
                columns={[
                  { title: '№ ДС', dataIndex: 'number', width: 90 },
                  {
                    title: 'Сумма, ₽',
                    dataIndex: 'amount',
                    align: 'right',
                    width: 160,
                    render: (v: string) => <MoneyText value={v} keepZero />,
                  },
                  {
                    title: 'Дата подписания',
                    dataIndex: 'dateSigned',
                    width: 140,
                    render: (v: string | null) => fmtDate(v) || '—',
                  },
                  {
                    title: 'Продление ЗОС',
                    dataIndex: 'zosExtensionDate',
                    width: 140,
                    render: (v: string | null) => fmtDate(v) || '—',
                  },
                  { title: 'Примечание', dataIndex: 'note' },
                  {
                    title: '',
                    key: 'actions',
                    width: 90,
                    render: (_, row) => (
                      <Space>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingAmendment(row);
                            amendmentForm.setFieldsValue({
                              ...row,
                              dateSigned: fromIso(row.dateSigned),
                              zosExtensionDate: fromIso(row.zosExtensionDate),
                            });
                            setAmendmentOpen(true);
                          }}
                        />
                        <Popconfirm
                          title="Удалить ДС?"
                          okText="Удалить"
                          okButtonProps={{ danger: true }}
                          cancelText="Отмена"
                          onConfirm={async () => {
                            try {
                              await deleteAmendment.mutateAsync(row.id);
                              message.success('ДС удалено');
                            } catch (e) {
                              message.error((e as Error).message);
                            }
                          }}
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </>
      )}

      <Drawer
        title={contract ? 'Изменить договор' : 'Новый договор'}
        open={contractOpen}
        width={520}
        onClose={() => setContractOpen(false)}
        destroyOnHidden
        extra={
          <Button type="primary" loading={saveContract.isPending} onClick={() => contractForm.submit()}>
            Сохранить
          </Button>
        }
      >
        <Form
          form={contractForm}
          layout="vertical"
          onFinish={async (values: Record<string, unknown>) => {
            try {
              await saveContract.mutateAsync({
                number: values.number as string,
                amount: String(values.amount ?? '0'),
                dateSigned: toIso(values.dateSigned as Dayjs | null),
                zosDate: toIso(values.zosDate as Dayjs | null),
                customerName: (values.customerName as string) ?? '',
                contractorName: (values.contractorName as string) ?? '',
                subject: (values.subject as string) ?? '',
              });
              setContractOpen(false);
              message.success('Договор сохранён');
            } catch (e) {
              message.error((e as Error).message);
            }
          }}
        >
          <Form.Item name="number" label="Номер договора" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="amount"
            label="Сумма, ₽ (с НДС)"
            rules={[{ pattern: /^-?\d+([.,]\d{1,2})?$/, message: 'Число с точностью до копеек' }]}
            normalize={(v: string) => (typeof v === 'string' ? v.replace(',', '.') : v)}
          >
            <Input style={{ width: 220 }} />
          </Form.Item>
          <Space size={12}>
            <Form.Item name="dateSigned" label="Дата подписания">
              <DatePicker format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="zosDate" label="Дата ЗОС">
              <DatePicker format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
          <Form.Item name="customerName" label="Заказчик">
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item name="contractorName" label="Генподрядчик">
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item name="subject" label="Предмет договора (стройка)">
            <Input.TextArea autoSize={{ minRows: 3 }} />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={editingAmendment ? `Изменить ДС №${editingAmendment.number}` : 'Новое ДС'}
        open={amendmentOpen}
        width={480}
        onClose={() => setAmendmentOpen(false)}
        destroyOnHidden
        extra={
          <Button type="primary" loading={saveAmendment.isPending} onClick={() => amendmentForm.submit()}>
            Сохранить
          </Button>
        }
      >
        <Form
          form={amendmentForm}
          layout="vertical"
          onFinish={async (values: Record<string, unknown>) => {
            if (!contract) return;
            try {
              await saveAmendment.mutateAsync({
                id: editingAmendment?.id,
                contractId: contract.id,
                number: values.number as string,
                amount: String(values.amount ?? '0').replace(',', '.'),
                dateSigned: toIso(values.dateSigned as Dayjs | null),
                zosExtensionDate: toIso(values.zosExtensionDate as Dayjs | null),
                note: (values.note as string) ?? '',
              });
              setAmendmentOpen(false);
              message.success('ДС сохранено');
            } catch (e) {
              message.error((e as Error).message);
            }
          }}
        >
          <Form.Item name="number" label="Номер ДС" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input style={{ width: 160 }} autoFocus />
          </Form.Item>
          <Form.Item
            name="amount"
            label="Сумма, ₽ (с НДС)"
            rules={[{ pattern: /^-?\d+([.,]\d{1,2})?$/, message: 'Число с точностью до копеек' }]}
            normalize={(v: string) => (typeof v === 'string' ? v.replace(',', '.') : v)}
          >
            <Input style={{ width: 220 }} />
          </Form.Item>
          <Space size={12}>
            <Form.Item name="dateSigned" label="Дата подписания">
              <DatePicker format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="zosExtensionDate" label="Продление ЗОС">
              <DatePicker format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </Form>
      </Drawer>
    </Space>
  );
}
