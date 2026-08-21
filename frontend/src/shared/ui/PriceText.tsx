import { theme } from 'antd';
import { fmtPrice } from '../lib/formatters';

interface Props {
  value: string | null | undefined;
  /**
   * Сколько знаков показывать. По умолчанию 6 — как в книге. В режиме «без НДС»
   * грид просит 2: там дробный хвост берётся от деления на (100 + ставка) и к
   * исходной расценке отношения не имеет. Значение в API при этом остаётся точным —
   * по нему считают экспорт и сверки.
   */
  precision?: 2 | 6;
}

/**
 * Цена за единицу. Отдельно от MoneyText: расценка хранится с 6 знаками, и
 * форматирование её до копеек скрывало бы то, чем строка отличается от файла.
 */
export function PriceText({ value, precision = 6 }: Props) {
  const { token } = theme.useToken();
  const n = value === null || value === undefined || value === '' ? null : Number(value);
  if (n === null || n === 0) {
    return <span className="num" style={{ color: token.colorTextTertiary }}>—</span>;
  }
  return <span className="num">{fmtPrice(value, precision)}</span>;
}
