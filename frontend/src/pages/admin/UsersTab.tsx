import { KeyOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import {
  useCreateUser,
  useObjects,
  usePatchUser,
  useSetUserObjects,
  useSetUserPassword,
  useUsers,
} from '../../api/hooks';
import type { AdminUser } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../shared/lib/useFeedback';
import { StatusTag } from '../../shared/ui/StatusTag';

const ROLE_OPTIONS = [
  { value: 'economist', label: 'Экономист' },
  { value: 'manager', label: 'Руководитель' },
  { value: 'admin', label: 'Администратор' },
];

export function UsersTab() {
  const { user: me } = useAuth();
  const { message, modal } = useFeedback();
  const users = useUsers();
  const objects = useObjects();
  const createUser = useCreateUser();
  const patchUser = usePatchUser();
  const setObjects = useSetUserObjects();
  const setPassword = useSetUserPassword();

  const [createOpen, setCreateOpen] = useState(false);
  const [objectsFor, setObjectsFor] = useState<AdminUser | null>(null);
  const [objectIds, setObjectIds] = useState<string[]>([]);
  const [createForm] = Form.useForm();

  const askPassword = (u: AdminUser) => {
    let value = '';
    modal.confirm({
      title: `Новый пароль для ${u.fullName}`,
      content: (
        <Input.Password
          placeholder="Не короче 8 символов"
          onChange={(e) => {
            value = e.target.value;
          }}
        />
      ),
      okText: 'Установить',
      cancelText: 'Отмена',
      onOk: async () => {
        if (value.length < 8) {
          message.error('Пароль не короче 8 символов');
          return Promise.reject();
        }
        await setPassword.mutateAsync({ id: u.id, password: value });
        message.success('Пароль установлен');
      },
    });
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Создать пользователя
        </Button>
      </Space>
      <Table<AdminUser>
        size="middle"
        rowKey="id"
        loading={users.isLoading}
        dataSource={users.data ?? []}
        pagination={false}
        columns={[
          {
            title: 'ФИО',
            dataIndex: 'fullName',
            render: (v: string, row) => (
              <Space direction="vertical" size={0}>
                <span>{v}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.email}
                </Typography.Text>
              </Space>
            ),
          },
          { title: 'Должность', dataIndex: 'position', width: 180 },
          {
            title: 'Роль',
            dataIndex: 'role',
            width: 170,
            render: (v: string, row) => (
              <Select
                size="small"
                value={v}
                options={ROLE_OPTIONS}
                style={{ width: 150 }}
                disabled={row.id === me?.id}
                onChange={async (role) => {
                  try {
                    await patchUser.mutateAsync({ id: row.id, role });
                    message.success('Роль изменена');
                  } catch (e) {
                    message.error((e as Error).message);
                  }
                }}
              />
            ),
          },
          {
            title: 'Объекты',
            key: 'objects',
            render: (_, row) => (
              <Space wrap size={4}>
                {row.objects.length === 0 ? (
                  <Typography.Text type="secondary">все объекты</Typography.Text>
                ) : (
                  row.objects.map((o) => <Tag key={o.id}>{o.code}</Tag>)
                )}
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setObjectsFor(row);
                    setObjectIds(row.objects.map((o) => o.id));
                  }}
                >
                  назначить
                </Button>
              </Space>
            ),
          },
          {
            title: 'Статус',
            dataIndex: 'isActive',
            width: 200,
            render: (v: boolean, row) => (
              <Space>
                <StatusTag status={v ? 'active' : 'inactive'} compact />
                <Switch
                  size="small"
                  checked={v}
                  disabled={row.id === me?.id}
                  onChange={async (checked) => {
                    try {
                      await patchUser.mutateAsync({ id: row.id, isActive: checked });
                      message.success(checked ? 'Учётная запись активирована' : 'Учётная запись отключена');
                    } catch (e) {
                      message.error((e as Error).message);
                    }
                  }}
                />
              </Space>
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 60,
            render: (_, row) => (
              <Button
                size="small"
                type="text"
                icon={<KeyOutlined />}
                title="Установить пароль"
                onClick={() => askPassword(row)}
              />
            ),
          },
        ]}
      />

      <Drawer
        title="Новый пользователь"
        open={createOpen}
        width={480}
        onClose={() => setCreateOpen(false)}
        destroyOnHidden
        extra={
          <Button type="primary" loading={createUser.isPending} onClick={() => createForm.submit()}>
            Создать
          </Button>
        }
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ role: 'economist', position: '' }}
          onFinish={async (values: {
            fullName: string;
            email: string;
            position: string;
            role: string;
            password: string;
          }) => {
            try {
              await createUser.mutateAsync(values);
              setCreateOpen(false);
              message.success('Пользователь создан (сразу активен)');
            } catch (e) {
              message.error((e as Error).message);
            }
          }}
        >
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true, min: 3, message: 'Укажите ФИО' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="email"
            label="Почта"
            rules={[{ required: true, type: 'email', message: 'Корректная почта' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="position" label="Должность">
            <Input />
          </Form.Item>
          <Form.Item name="role" label="Роль">
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="password"
            label="Временный пароль"
            rules={[{ required: true, min: 8, message: 'Не короче 8 символов' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title={`Объекты: ${objectsFor?.fullName ?? ''}`}
        open={Boolean(objectsFor)}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={setObjects.isPending}
        onCancel={() => setObjectsFor(null)}
        onOk={async () => {
          if (!objectsFor) return;
          try {
            await setObjects.mutateAsync({ id: objectsFor.id, objectIds });
            setObjectsFor(null);
            message.success('Назначения обновлены');
          } catch (e) {
            message.error((e as Error).message);
          }
        }}
      >
        <Typography.Paragraph type="secondary">
          Если объекты не выбраны — пользователю видны все объекты.
        </Typography.Paragraph>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Все объекты"
          optionFilterProp="label"
          value={objectIds}
          options={(objects.data ?? []).map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))}
          onChange={setObjectIds}
        />
      </Modal>
    </>
  );
}
