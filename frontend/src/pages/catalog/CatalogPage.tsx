import { Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { ContractsTab } from './ContractsTab';
import { ObjectsTab } from './ObjectsTab';

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'objects';
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Справочники
      </Typography.Title>
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          const next = new URLSearchParams(params);
          next.set('tab', key);
          setParams(next, { replace: true });
        }}
        items={[
          { key: 'objects', label: 'Объекты строительства', children: <ObjectsTab /> },
          { key: 'contracts', label: 'Договоры и ДС', children: <ContractsTab /> },
        ]}
      />
    </div>
  );
}
