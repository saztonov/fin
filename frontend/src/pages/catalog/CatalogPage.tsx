import { Typography } from 'antd';
import { ObjectsTab } from './ObjectsTab';

export function CatalogPage() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Справочники
      </Typography.Title>
      <ObjectsTab />
    </div>
  );
}
