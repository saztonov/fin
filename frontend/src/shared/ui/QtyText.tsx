import { theme } from 'antd';
import { fmtQty } from '../lib/formatters';

export function QtyText({ value }: { value: string | null | undefined }) {
  const { token } = theme.useToken();
  const n = value === null || value === undefined || value === '' ? null : Number(value);
  if (n === null || n === 0) {
    return <span className="num" style={{ color: token.colorTextTertiary }}>—</span>;
  }
  return <span className="num">{fmtQty(value)}</span>;
}
