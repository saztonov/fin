import { Avatar, Button, Dropdown, Layout, Menu, Tooltip, Typography, theme } from 'antd';
import {
  DatabaseOutlined,
  FileDoneOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLocalStorageState } from '../shared/lib/useLocalStorageState';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Руководитель',
  economist: 'Экономист',
};

const SIDER_WIDTH = 220;
const SIDER_WIDTH_COLLAPSED = 64;

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useLocalStorageState('ks.sidebarCollapsed', false);

  const items = [
    { key: '/ks', icon: <FileDoneOutlined />, title: 'КС', label: <Link to="/ks">КС</Link> },
    ...(user && user.role !== 'economist'
      ? [
          {
            key: '/refs',
            icon: <DatabaseOutlined />,
            title: 'Справочники',
            label: <Link to="/refs">Справочники</Link>,
          },
        ]
      : []),
    ...(user?.role === 'admin'
      ? [
          {
            key: '/admin',
            icon: <SettingOutlined />,
            title: 'Администрирование',
            label: <Link to="/admin">Администрирование</Link>,
          },
        ]
      : []),
  ];

  const selected = items
    .map((i) => i.key)
    .filter((k) => location.pathname === k || location.pathname.startsWith(`${k}/`));

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: 'Профиль' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти' },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'profile') navigate('/profile');
      if (key === 'logout') void logout();
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        theme="light"
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={SIDER_WIDTH}
        collapsedWidth={SIDER_WIDTH_COLLAPSED}
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          borderInlineEnd: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div
            style={{
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? 0 : '0 16px',
              flex: '0 0 auto',
            }}
          >
            <Typography.Text strong style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
              {collapsed ? 'СУ-10' : 'СУ-10 · КС'}
            </Typography.Text>
          </div>

          <Menu
            mode="inline"
            inlineCollapsed={collapsed}
            items={items}
            selectedKeys={selected.length > 0 ? [selected[selected.length - 1]!] : []}
            style={{ flex: 1, minHeight: 0, overflow: 'auto', borderInlineEnd: 'none' }}
          />

          <div
            style={{
              flex: '0 0 auto',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <Dropdown menu={userMenu} placement={collapsed ? 'topRight' : 'top'}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: collapsed ? 8 : '8px 8px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: token.borderRadius,
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
              >
                <Avatar size="small" icon={<UserOutlined />} />
                {!collapsed && (
                  <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                    <Typography.Text
                      style={{ display: 'block' }}
                      ellipsis={{ tooltip: user?.fullName }}
                    >
                      {user?.fullName}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {user ? ROLE_LABEL[user.role] : ''}
                    </Typography.Text>
                  </div>
                )}
              </div>
            </Dropdown>

            <Tooltip title={collapsed ? 'Развернуть меню' : ''} placement="right">
              <Button
                type="text"
                block
                aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
              >
                {collapsed ? null : 'Свернуть меню'}
              </Button>
            </Tooltip>
          </div>
        </div>
      </Layout.Sider>

      <Layout.Content style={{ padding: 16, minWidth: 0 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
