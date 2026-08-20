import { Button, Card, Form, Input, Result, theme, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiClientError } from '../../api/client';
import { useFeedback } from '../../shared/lib/useFeedback';

export function RegisterPage() {
  const { message } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { token } = theme.useToken();

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
      <Card style={{ width: 440 }}>
        {done ? (
          <Result
            status="success"
            title="Заявка отправлена"
            subTitle="Учётная запись станет доступна после активации администратором. Вы получите доступ — попробуйте войти позже."
            extra={
              <Link to="/login">
                <Button type="primary">К входу</Button>
              </Link>
            }
          />
        ) : (
          <>
            <Typography.Title level={4} style={{ marginTop: 0 }}>
              Регистрация
            </Typography.Title>
            <Form
              layout="vertical"
              onFinish={async (values: {
                fullName: string;
                email: string;
                position: string;
                password: string;
              }) => {
                setLoading(true);
                try {
                  await api('/auth/register', { body: values });
                  setDone(true);
                } catch (e) {
                  message.error(
                    e instanceof ApiClientError ? e.message : 'Не удалось зарегистрироваться',
                  );
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Form.Item
                name="fullName"
                label="ФИО"
                rules={[{ required: true, min: 3, message: 'Укажите ФИО' }]}
              >
                <Input autoFocus />
              </Form.Item>
              <Form.Item
                name="email"
                label="Почта"
                rules={[{ required: true, type: 'email', message: 'Укажите корректную почту' }]}
              >
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item name="position" label="Должность" initialValue="">
                <Input placeholder="Например: экономист объекта" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Пароль"
                rules={[{ required: true, min: 8, message: 'Не короче 8 символов' }]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                Отправить заявку
              </Button>
            </Form>
            <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
              Уже есть учётная запись? <Link to="/login">Войти</Link>
            </Typography.Paragraph>
          </>
        )}
      </Card>
    </div>
  );
}
