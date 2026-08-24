import { Button, Space } from 'antd';
import { useState } from 'react';
import { useVersionCheck } from '../lib/useVersionCheck';

/**
 * Плашка «доступна новая версия» — показывается, когда вкладка работает на устаревшем
 * бандле. «Позже» скрывает её до перезагрузки страницы.
 *
 * «Обновить» — обычный reload: index.html раздаётся с no-cache, ассеты имеют контент-хэш,
 * поэтому чистить кэш вручную не нужно. Несохранённые объёмы КС-2 прикрыты
 * beforeunload-guard в KsPage — браузер сам спросит подтверждение.
 */
export function AppUpdateBanner() {
  const { updateAvailable } = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);
  if (!updateAvailable || dismissed) return null;

  return (
    <div className="app-update-banner" role="status">
      <span>Доступна новая версия приложения</span>
      <Space size={8}>
        <Button type="primary" onClick={() => window.location.reload()}>
          Обновить
        </Button>
        <Button onClick={() => setDismissed(true)}>Позже</Button>
      </Space>
    </div>
  );
}
