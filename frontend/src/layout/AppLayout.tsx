import { Avatar, Dropdown, Layout, Menu, Space, theme, Typography } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Руководитель',
  economist: 'Экономист',
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = theme.useToken();

  const items = [
    { key: '/ks', label: <Link to="/ks">КС</Link> },
    ...(user && user.role !== 'economist'
      ? [{ key: '/refs', label: <Link to="/refs">Справочники</Link> }]
      : []),
    ...(user?.role === 'admin'
      ? [{ key: '/admin', label: <Link to="/admin">Администрирование</Link> }]
      : []),
  ];

  const selected = items
    .map((i) => i.key)
    .filter((k) => location.pathname === k || location.pathname.startsWith(`${k}/`));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Typography.Text strong style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
          СУ-10 · КС
        </Typography.Text>
        <Menu
          mode="horizontal"
          items={items}
          selectedKeys={selected.length > 0 ? [selected[selected.length - 1]!] : []}
          style={{ flex: 1, borderBottom: 'none' }}
        />
        <Dropdown
          menu={{
            items: [
              { key: 'profile', icon: <UserOutlined />, label: 'Профиль' },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти' },
            ],
            onClick: ({ key }) => {
              if (key === 'profile') navigate('/profile');
              if (key === 'logout') void logout();
            },
          }}
        >
          <Space style={{ cursor: 'pointer' }}>
            <Avatar size="small" icon={<UserOutlined />} />
            <span>
              <Typography.Text>{user?.fullName}</Typography.Text>
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {user ? ROLE_LABEL[user.role] : ''}
              </Typography.Text>
            </span>
          </Space>
        </Dropdown>
      </Layout.Header>
      <Layout.Content style={{ padding: 16 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
