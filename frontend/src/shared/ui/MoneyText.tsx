import { theme } from 'antd';
import { fmtMoney } from '../lib/formatters';

interface Props {
  value: string | null | undefined;
  strong?: boolean;
  /** показывать 0,00 вместо тире */
  keepZero?: boolean;
  /** подсветить отрицательное значение цветом ошибки */
  markNegative?: boolean;
}

/** Единственное место форматирования денег в UI. */
export function MoneyText({ value, strong, keepZero, markNegative }: Props) {
  const { token } = theme.useToken();
  const n = value === null || value === undefined || value === '' ? null : Number(value);
  if (n === null || (!keepZero && n === 0)) {
    return <span className="num" style={{ color: token.colorTextTertiary }}>—</span>;
  }
  const negative = markNegative && n < 0;
  return (
    <span
      className="num"
      style={{
        fontWeight: strong ? 600 : undefined,
        color: negative ? token.colorError : undefined,
      }}
    >
      {fmtMoney(value)}
    </span>
  );
}
