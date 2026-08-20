import { Button, Card, Descriptions, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiClientError, setSession } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../shared/lib/useFeedback';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Руководитель',
  economist: 'Экономист',
};

export function ProfilePage() {
  const { user } = useAuth();
  const { message } = useFeedback();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 720 }}>
      <Card title="Профиль">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="ФИО">{user.fullName}</Descriptions.Item>
          <Descriptions.Item label="Почта">{user.email}</Descriptions.Item>
          <Descriptions.Item label="Должность">{user.position || '—'}</Descriptions.Item>
          <Descriptions.Item label="Роль">{ROLE_LABEL[user.role]}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Смена пароля">
        <Typography.Paragraph type="secondary">
          После смены пароля все сессии будут завершены — потребуется войти заново.
        </Typography.Paragraph>
        <Form
          layout="vertical"
          style={{ maxWidth: 400 }}
          onFinish={async (values: { currentPassword: string; newPassword: string }) => {
            setLoading(true);
            try {
              await api('/auth/change-password', { body: values });
              message.success('Пароль изменён. Войдите заново.');
              setSession(null, null);
              navigate('/login');
            } catch (e) {
              message.error(e instanceof ApiClientError ? e.message : 'Не удалось сменить пароль');
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item
            name="currentPassword"
            label="Текущий пароль"
            rules={[{ required: true, message: 'Введите текущий пароль' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="Новый пароль"
            rules={[{ required: true, min: 8, message: 'Не короче 8 символов' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Сменить пароль
          </Button>
        </Form>
      </Card>
    </Space>
  );
}
