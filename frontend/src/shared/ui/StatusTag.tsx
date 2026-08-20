import { Tag } from 'antd';

type Status =
  | 'draft'
  | 'approved'
  | 'ds'
  | 'new'
  | 'match'
  | 'changed'
  | 'missing'
  | 'active'
  | 'inactive';

const MAP: Record<Status, { color?: string; text: string; filled?: boolean }> = {
  draft: { color: 'gold', text: 'Черновик' },
  approved: { color: 'green', text: 'Утверждён', filled: true },
  ds: { color: 'geekblue', text: 'ДС' },
  new: { color: 'green', text: 'новая' },
  match: { text: 'совпадает' },
  changed: { color: 'gold', text: 'изменена' },
  missing: { color: 'red', text: 'нет в файле' },
  active: { color: 'green', text: 'Активен', filled: true },
  inactive: { color: 'gold', text: 'Ожидает активации' },
};

/** Единый маппинг статус → цвет для всего портала (КС-2, колонки, diff, пользователи). */
export function StatusTag({
  status,
  label,
  compact,
}: {
  status: Status;
  label?: string;
  compact?: boolean;
}) {
  const cfg = MAP[status];
  return (
    <Tag
      color={cfg.color}
      variant={cfg.filled ? 'filled' : undefined}
      style={compact ? { marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', paddingInline: 4 } : { marginInlineEnd: 0 }}
    >
      {label ?? cfg.text}
    </Tag>
  );
}
