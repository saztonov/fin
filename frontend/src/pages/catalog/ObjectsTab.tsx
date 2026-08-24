import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Empty, Form, Input, Popconfirm, Space, Table } from 'antd';
import { useState } from 'react';
import { useDeleteObject, useObjects, useSaveObject } from '../../api/hooks';
import type { ConstructionObject } from '../../api/types';
import { useFeedback } from '../../shared/lib/useFeedback';

export function ObjectsTab() {
  const { message } = useFeedback();
  const objects = useObjects();
  const save = useSaveObject();
  const remove = useDeleteObject();
  const [editing, setEditing] = useState<ConstructionObject | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const openDrawer = (obj: ConstructionObject | null) => {
    setEditing(obj);
    setOpen(true);
    form.setFieldsValue(obj ?? { code: '', name: '', address: '' });
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer(null)}>
          Добавить объект
        </Button>
      </Space>
      <Table<ConstructionObject>
        size="middle"
        rowKey="id"
        loading={objects.isLoading}
        dataSource={objects.data ?? []}
        pagination={false}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Объекты не заведены" />
          ),
        }}
        columns={[
          { title: 'Код', dataIndex: 'code', width: 90 },
          { title: 'Название', dataIndex: 'name' },
          { title: 'Адрес', dataIndex: 'address' },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_, row) => (
              <Space>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openDrawer(row)} />
                <Popconfirm
                  title="Удалить объект?"
                  okText="Удалить"
                  okButtonProps={{ danger: true }}
                  cancelText="Отмена"
                  onConfirm={async () => {
                    try {
                      await remove.mutateAsync(row.id);
                      message.success('Объект удалён');
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
      <Drawer
        title={editing ? 'Изменить объект' : 'Новый объект'}
        open={open}
        width={480}
        onClose={() => setOpen(false)}
        destroyOnHidden
        extra={
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Сохранить
          </Button>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values: { code: string; name: string; address: string }) => {
            try {
              await save.mutateAsync({ id: editing?.id, ...values });
              setOpen(false);
              message.success(editing ? 'Объект обновлён' : 'Объект создан');
            } catch (e) {
              message.error((e as Error).message);
            }
          }}
        >
          <Form.Item
            name="code"
            label="Код (до 6 символов)"
            rules={[
              { required: true, whitespace: true, message: 'Укажите код' },
              { max: 6, message: 'Не более 6 символов' },
            ]}
          >
            <Input maxLength={6} style={{ width: 140 }} autoFocus />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
