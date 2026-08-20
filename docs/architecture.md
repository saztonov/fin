# Архитектура портала «КС»

Базовая реализация по корпстандарту v3.1 (single-VPS baseline). Keycloak, S3,
Sentry/мониторинг — этап 2; код им не противоречит (standalone auth §13,
хранилище за интерфейсом `lib/storage`).

## Компоненты

```
frontend (React + AntD6, Vite)  ──►  api (Fastify, 127.0.0.1:3000)
                                        │        │
                                        ▼        ▼
                               PostgreSQL   local storage (.data/uploads; S3 — этап 2)
                                        ▲        ▲
                                        │        │
                                     worker ──► parse-child (одноразовый процесс,
                                     (PG-jobs)   без секретов: разбор Excel)
```

- **api** — stateless HTTP: auth, справочники, грид КС-6, КС-2, приём файлов
  (file-guard), diff/apply импорта, экспорт Excel. Файлы НЕ разбирает.
- **worker** — опрашивает таблицу `jobs` (FOR UPDATE SKIP LOCKED, аренда,
  fencing token, retry c backoff, dead-state). Тип задач: `import_parse`.
- **parse-child** — spawn на каждую задачу: чистый env (без DATABASE_URL и
  секретов), SIGKILL по wall-clock таймауту, лимит stdout. Внутри exceljs +
  эвристики листов «ПСДЦ»/«КС-6» (см. import-format.md).

## Модель данных

`construction_objects` 1─1 `contracts` (один объект = один договор) ─* `amendments` (ДС).
Структура сметы: `ks6_sections` (дерево, до 3 уровней) и `work_items`
(kind: `kvr` — агрегат, `nomenclature` — строка ввода; связь номенклатуры с её
КВР — по `kvr_item_id`, не по коду). Выполнение: `ks2_documents`
(draft/approved, unique номер в договоре) и `ks2_lines` (qty, amount).
Импорт: `import_files` + `import_staging` (payload разбора + summary).
Служебные: `users`, `refresh_tokens` (rotation + reuse detection), `audit_log`, `jobs`.

Деньги — `numeric(18,2)`, количества — `numeric(15,6)`; в коде ходят строками,
вся арифметика в `lib/money.ts` (decimal, half-up как в Excel). Soft delete
через `deleted_at` с partial-unique индексами.

## Расчёты (ks6.service)

- Стоимость ручного ввода: `round2(qty × unit_price)`; импортированная история —
  суммы **как в файле** (не пересчитываются).
- «Выполнено с начала строительства» = Σ строк **утверждённых** КС-2; черновики
  видны в своих колонках, в виджеты не входят.
- КВР = Σ его номенклатур (стоимость); раздел = Σ вложенных номенклатур;
  Итого = Σ всех номенклатур. «Остаток» = договор − выполнено (минус подсвечивается).
- НДС 20% выделяется из суммы с НДС (`×20/120`) только при отображении/экспорте.
- Договорные значения строк (`contract_total`) хранятся как в файле — копеечная
  совместимость с исходным Excel важнее пересчёта.

Нарастающие итоги считаются на лету (≤ ~300 строк × ~20 периодов) — materialized
view не нужен.

## Аутентификация (standalone, этап 1)

Регистрация → `is_active=false` → активация админом. Вход: access JWT (HS256,
15 мин) + opaque refresh в httpOnly cookie (`SameSite=Strict`,
path=/api/v1/auth, 30 дней), rotation при каждом refresh, reuse detection
(повторное предъявление использованного токена гасит всё семейство + audit).
CSRF-дисциплина cookie-эндпоинтов: обязательный заголовок `x-requested-with`.
Клиент держит access только в памяти и дедуплицирует параллельные refresh.
Финальная авторизация — на сервере: RBAC-плагин + object-scope guard
(экономист без назначений видит все объекты — требование заказчика).

## Наблюдаемость и эксплуатация

pino JSON-логи с redaction (authorization/cookie/password/token),
`/health/live` + `/health/ready` (ping БД), graceful shutdown, rate-limit
(общий + жёстче на auth), helmet-заголовки, request-id. Production startup
checks (config.ts): плейсхолдеры секретов и отсутствие TLS БД валят старт.
Деплой: immutable-образ (backend/Dockerfile: api|worker|migrate), миграции —
отдельный шаг, лимиты контейнеров в deploy/docker-compose.yml.
