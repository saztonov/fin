import { Button, Card, Form, Input, theme, Typography } from 'antd';
import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../shared/lib/useFeedback';

export function LoginPage() {
  const { user, ready, login } = useAuth();
  const { message } = useFeedback();
  const location = useLocation() as { state?: { from?: string } };
  const [loading, setLoading] = useState(false);
  const { token } = theme.useToken();

  if (ready && user) return <Navigate to={location.state?.from ?? '/ks'} replace />;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorBgLayout,
      }}
    >
      <Card style={{ width: 400 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          СУ-10 · Портал КС
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Учёт выполнения работ: КС-2 и КС-6
        </Typography.Paragraph>
        <Form
          layout="vertical"
          size="large"
          onFinish={async (values: { email: string; password: string }) => {
            setLoading(true);
            try {
              await login(values.email, values.password);
            } catch (e) {
              message.error(e instanceof ApiClientError ? e.message : 'Не удалось войти');
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item
            name="email"
            label="Почта"
            rules={[{ required: true, type: 'email', message: 'Укажите корректную почту' }]}
          >
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="Пароль"
            rules={[{ required: true, message: 'Введите пароль' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Войти
          </Button>
        </Form>
        <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
          Нет учётной записи? <Link to="/register">Зарегистрироваться</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
