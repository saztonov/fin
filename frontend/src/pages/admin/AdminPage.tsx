import { Tabs, Typography } from 'antd';
import { UsersTab } from './UsersTab';

export function AdminPage() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Администрирование
      </Typography.Title>
      <Tabs items={[{ key: 'users', label: 'Пользователи', children: <UsersTab /> }]} />
    </div>
  );
}
