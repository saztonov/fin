import { Alert, Card, Col, Row, Statistic, theme } from 'antd';
import type { Ks6Grid } from '../../api/types';
import { fmtMoney } from '../../shared/lib/formatters';

function MoneyStat({ title, value, accent }: { title: string; value: string; accent?: string }) {
  const [rub, kop] = fmtMoney(value).split(',');
  const { token } = theme.useToken();
  return (
    <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
      <Statistic
        title={title}
        valueRender={() => (
          <span className="num" style={{ color: accent }}>
            {rub}
            <span style={{ fontSize: 16, color: token.colorTextSecondary }}>
              ,{kop ?? '00'} ₽
            </span>
          </span>
        )}
      />
    </Card>
  );
}

/** Виджеты: сумма договора / выполнено (утверждённые КС-2) / остаток. */
export function SummaryStats({ grid }: { grid: Ks6Grid }) {
  const { token } = theme.useToken();
  const negative = Number(grid.totals.remainderAmount) < 0;
  return (
    <div>
      <Row gutter={12}>
        <Col span={8}>
          <MoneyStat title="Сумма договора (с НДС)" value={grid.totals.contractTotal} />
        </Col>
        <Col span={8}>
          <MoneyStat title="Выполнено всего (утверждено)" value={grid.totals.executedAmount} />
        </Col>
        <Col span={8}>
          <MoneyStat
            title="Остаток"
            value={grid.totals.remainderAmount}
            accent={negative ? token.colorError : undefined}
          />
        </Col>
      </Row>
      {grid.totals.catalogMismatch ? (
        <Alert
          style={{ marginTop: 8 }}
          type="warning"
          showIcon
          title={`Сумма по справочнику договора и ДС (${fmtMoney(grid.totals.catalogAmount)} ₽) не совпадает с суммой строк сметы (${fmtMoney(grid.totals.contractTotal)} ₽)`}
        />
      ) : null}
    </div>
  );
}
