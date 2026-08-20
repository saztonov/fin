import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth, RequireRole } from '../auth/guards';
import { AppLayout } from '../layout/AppLayout';
import { AdminPage } from '../pages/admin/AdminPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { CatalogPage } from '../pages/catalog/CatalogPage';
import { ImportWizardPage } from '../pages/import/ImportWizardPage';
import { KsPage } from '../pages/ks/KsPage';
import { ProfilePage } from '../pages/profile/ProfilePage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/ks" replace /> },
      { path: '/ks', element: <KsPage /> },
      {
        path: '/ks/import',
        element: (
          <RequireRole roles={['admin', 'manager']}>
            <ImportWizardPage />
          </RequireRole>
        ),
      },
      {
        path: '/refs',
        element: (
          <RequireRole roles={['admin', 'manager']}>
            <CatalogPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin',
        element: (
          <RequireRole roles={['admin']}>
            <AdminPage />
          </RequireRole>
        ),
      },
      { path: '/profile', element: <ProfilePage /> },
      { path: '*', element: <Navigate to="/ks" replace /> },
    ],
  },
]);
