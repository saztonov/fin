import { SearchOutlined } from '@ant-design/icons';
import { Button, Col, Empty, Input, Result, Row, Skeleton, Space, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useObjectsSummary } from '../../api/hooks';
import type { Role } from '../../api/types';
import { ObjectCard } from './ObjectCard';

interface Props {
  role: Role;
  onOpen: (id: string) => void;
}

/** Стартовый экран КС: сетка карточек объектов с цифрами сметы. */
export function ObjectPicker({ role, onOpen }: Props) {
  const objects = useObjectsSummary();
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = objects.data ?? [];
    const filtered = q
      ? rows.filter((o) =>
          [o.code, o.name, o.address].some((f) => f.toLowerCase().includes(q)),
        )
      : rows;
    return [...filtered].sort((a, b) => a.code.localeCompare(b.code, 'ru'));
  }, [objects.data, search]);

  if (objects.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (objects.isError) {
    return (
      <Result
        status="error"
        title="Не удалось загрузить объекты"
        extra={<Button onClick={() => void objects.refetch()}>Повторить</Button>}
      />
    );
  }

  const empty = (objects.data ?? []).length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap size={12} style={{ width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Объекты строительства
        </Typography.Title>
        {!empty ? (
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Поиск по коду, названию, адресу"
            style={{ width: 340 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        ) : null}
      </Space>

      {empty ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 48 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Объекты строительства не заведены"
          >
            {role !== 'economist' ? (
              <Link to="/refs">
                <Button type="primary">Добавить объект</Button>
              </Link>
            ) : (
              <Typography.Text type="secondary">
                Обратитесь к руководителю или администратору
              </Typography.Text>
            )}
          </Empty>
        </div>
      ) : list.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Объекты не найдены" />
      ) : (
        <Row gutter={[16, 16]}>
          {list.map((o) => (
            <Col key={o.id} xs={24} sm={12} lg={8} xl={6}>
              <ObjectCard object={o} onOpen={onOpen} />
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );
}
