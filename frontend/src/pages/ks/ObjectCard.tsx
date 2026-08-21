import { FileTextOutlined } from '@ant-design/icons';
import { Card, Space, Tag, theme, Tooltip, Typography } from 'antd';
import type { ObjectSummary } from '../../api/types';
import { fmtMoney } from '../../shared/lib/formatters';

/**
 * Обложка-заглушка: фотографий объектов в портале нет, поэтому цвет выводится
 * из кода объекта — карточка одного и того же объекта всегда одного оттенка,
 * и в сетке из двух десятков он узнаётся быстрее названия.
 */
function cover(code: string) {
  const hue = ((code.charCodeAt(0) || 65) * 37) % 360;
  return (
    <div
      style={{
        height: 140,
        background: `linear-gradient(135deg, hsl(${hue},48%,52%), hsl(${(hue + 40) % 360},48%,42%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: 'rgba(255,255,255,0.92)',
      }}
    >
      <FileTextOutlined style={{ fontSize: 34, opacity: 0.75 }} />
      <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: 1 }}>{code}</span>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const { token } = theme.useToken();
  return (
    <>
      <span
        style={{
          color: token.colorTextTertiary,
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {/* суммы объекта девятизначные: перенос «₽» на вторую строку ломал бы сетку */}
      <span
        className="num"
        style={{ textAlign: 'right', color: accent, fontSize: 13, whiteSpace: 'nowrap' }}
      >
        {fmtMoney(value)} ₽
      </span>
    </>
  );
}

interface Props {
  object: ObjectSummary;
  onOpen: (id: string) => void;
}

/** Карточка объекта на стартовом экране КС: цифры договора вместо выпадающего списка. */
export function ObjectCard({ object: o, onOpen }: Props) {
  const { token } = theme.useToken();
  const negative = Number(o.remainderAmount) < 0;

  return (
    <Card
      hoverable
      cover={cover(o.code)}
      styles={{ body: { padding: 16 } }}
      onClick={() => onOpen(o.id)}
    >
      <div style={{ marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <Tooltip title={o.name} mouseEnterDelay={0.5}>
          <strong>{o.name}</strong>
        </Tooltip>
      </div>
      <div
        style={{
          color: token.colorTextTertiary,
          fontSize: 13,
          marginBottom: 12,
          minHeight: 18,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {o.address || '—'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, columnGap: 8 }}>
        <Row label="Договор" value={o.contractTotal} />
        <Row label="Выполнено" value={o.executedAmount} />
        <Row
          label="Остаток"
          value={o.remainderAmount}
          accent={negative ? token.colorError : undefined}
        />
      </div>

      <Space wrap size={6} style={{ marginTop: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          КС-2: {o.ks2Count}
        </Typography.Text>
        {o.partTitle ? (
          <Tooltip title="Смета разделена по ставкам НДС — на карточке цифры актуальной версии. Обе версии видны внутри объекта на вкладках.">
            <Tag color="blue">{o.partTitle}</Tag>
          </Tooltip>
        ) : null}
        {!o.hasContract ? <Tag>Договор не заведён</Tag> : null}
        {o.catalogMismatch ? (
          <Tooltip
            title={`По справочнику договора и ДС: ${fmtMoney(o.catalogAmount)} ₽, по строкам сметы: ${fmtMoney(o.contractTotal)} ₽`}
          >
            <Tag color="warning">не сходится со справочником</Tag>
          </Tooltip>
        ) : null}
      </Space>
    </Card>
  );
}
