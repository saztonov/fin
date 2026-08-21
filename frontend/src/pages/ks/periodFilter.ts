import type { PeriodInfo } from '../../api/types';

/** Последний день месяца 'YYYY-MM' в виде ISO-даты. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return `${month}-31`;
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * КС-2 попадает в выборку, если его отчётный период пересекается с [from, to]
 * (границы задаются месяцами 'YYYY-MM', любая из них может отсутствовать).
 * Документ без периода и без даты составления при заданном фильтре выпадает —
 * это видно по счётчику «показано N из M».
 * `alwaysIncludeId` — выбранный для ввода документ, его колонка нужна всегда.
 */
export function filterPeriods(
  periods: PeriodInfo[],
  from: string | null,
  to: string | null,
  alwaysIncludeId: string | null,
): PeriodInfo[] {
  if (!from && !to) return periods;
  const fromStart = from ? `${from}-01` : null;
  const toEnd = to ? monthEnd(to) : null;
  return periods.filter((p) => {
    if (p.id === alwaysIncludeId) return true;
    const docFrom = p.periodFrom ?? p.docDate;
    const docTo = p.periodTo ?? p.periodFrom ?? p.docDate;
    if (!docFrom || !docTo) return false;
    if (toEnd && docFrom > toEnd) return false;
    if (fromStart && docTo < fromStart) return false;
    return true;
  });
}
