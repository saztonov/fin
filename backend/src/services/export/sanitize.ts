/**
 * Защита экспортируемых значений (skill office-documents §экспорт):
 * строки внешнего происхождения не должны интерпретироваться как формулы.
 */
export function sanitizeCellText(value: string): string {
  // управляющие символы — вон
  // eslint-disable-next-line no-control-regex
  let s = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  // ведущие символы формул экранируются апострофом
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}
