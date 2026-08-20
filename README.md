# Портал «КС» — учёт выполнения строительных работ (СУ-10)

Экономисты объектов ежемесячно вносят выполнение работ (КС-2), портал считает
стоимость и собирает накопительную ведомость КС-6 на базе сметы договора (ПСДЦ).
Поддерживается импорт существующих ПСДЦ/КС-6 из Excel (со всей историей
помесячных выполнений) и экспорт КС-6/КС-2 обратно в Excel.

Стек — по корпстандарту v3.1: Fastify + Drizzle (SQL-first миграции) + zod + pino,
React + TypeScript + **Ant Design 6**, PostgreSQL. Подробности: [docs/architecture.md](docs/architecture.md).

## Быстрый старт (разработка, Windows/Linux, Docker не нужен)

```bash
npm install
cp .env.example .env            # значения по умолчанию подходят для dev

npm run db:dev                  # PostgreSQL 17 (embedded) на 127.0.0.1:5439; остановка: npm run db:stop -w backend
npm run migrate                 # SQL-миграции backend/drizzle/*
npm run seed                    # первый администратор из SEED_ADMIN_* (.env)

npm run dev:api                 # Fastify API на 127.0.0.1:3000
npm run dev:worker              # worker фоновых задач (разбор Excel)
npm run dev:web                 # Vite на http://localhost:5173 (proxy /api → 3000)
```

Вход: `admin@example.com` / `admin12345` (из `.env`). Новые пользователи
регистрируются сами и ждут активации администратором (страница «Администрирование»).

Если установлен Docker, dev-БД можно поднять и так:
`docker compose -f deploy/docker-compose.dev.yml up -d` (порт тот же 5439).

## Проверки

```bash
npm run test -w backend         # vitest: money, парсеры, file-guard (враждебные файлы)
npm run typecheck               # tsc backend + frontend
npm run verify-import -w backend  # сквозная проверка: реальный файл из temp/ через API
                                  # (нужны запущенные db + api + worker)
```

## Роли

| Роль | Права |
|---|---|
| `economist` | назначенные объекты (если не назначены — все); ввод объёмов в черновики КС-2; свои черновики |
| `manager` | все объекты; справочники; структура сметы; импорт; утверждение/возврат КС-2 |
| `admin` | всё + администрирование пользователей; перезапись КС-2 при импорте |

## Структура

```
backend/   Fastify API + worker (+ parse-child: изолированный разбор Excel)
frontend/  React + AntD6 (страницы: КС, Справочники, Администрирование)
deploy/    docker-compose (dev-БД и production api+worker), nginx-заготовка
docs/      архитектура, формат импорта, отступления от стандартов
```

Production-развёртывание (single-VPS baseline): образ собирается из
`backend/Dockerfile` (api|worker|migrate), запускается `deploy/docker-compose.yml`
с immutable-тегом, миграции — отдельным шагом (`docker compose run --rm migrate`),
фронтенд раздаётся nginx статикой ([deploy/nginx/ks.conf.example](deploy/nginx/ks.conf.example)).
Keycloak/SSO, S3, мониторинг — этап 2.
