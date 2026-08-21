import { theme } from 'antd';
import { fmtPrice } from '../lib/formatters';

interface Props {
  value: string | null | undefined;
}

/**
 * Цена за единицу. Отдельно от MoneyText: расценка хранится с 6 знаками, и
 * форматирование её до копеек скрывало бы то, чем строка отличается от файла.
 */
export function PriceText({ value }: Props) {
  const { token } = theme.useToken();
  const n = value === null || value === undefined || value === '' ? null : Number(value);
  if (n === null || n === 0) {
    return <span className="num" style={{ color: token.colorTextTertiary }}>—</span>;
  }
  return <span className="num">{fmtPrice(value)}</span>;
}
