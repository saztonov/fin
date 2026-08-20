#!/usr/bin/env bash
# Деплой портала «КС» (fin) — запускать НА VPS. Portal-scoped (корпстандарт §19):
# не трогает соседние порталы, infra-nginx, Keycloak. Подключается симлинком:
#   sudo ln -sf /opt/portals/fin/deploy/deploy-fin.sh /usr/local/bin/deploy-fin
#
#   deploy-fin             — git pull + сборка образов + перезапуск api/worker/web
#   deploy-fin --migrate   — то же + накат SQL-миграций (роль fin_migration)
#
# Конфиг и секреты: /etc/fin/fin.env (640 root:docker), /etc/fin/fin-migrate.env (только
# для --migrate, тоже 640 root:docker). Первый администратор — отдельно, один раз:
#   docker compose -f deploy/docker-compose.prod.yml -p fin run --rm seed
#
# Секреты нигде не печатаются: значения переменных читаются и передаются дальше,
# но никогда не выводятся в stdout/stderr этого скрипта.
set -euo pipefail

ENV_FILE=/etc/fin/fin.env
MIGRATE_ENV_FILE=/etc/fin/fin-migrate.env
SCRIPT="$(readlink -f "$0")"
PORTAL_DIR="$(cd "$(dirname "$SCRIPT")/.." && pwd)"
COMPOSE=(docker compose -f "$PORTAL_DIR/deploy/docker-compose.prod.yml" -p fin)

usage() {
  cat <<'USAGE'
Использование: deploy-fin [--migrate]
  --migrate   применить новые SQL-миграции (нужен /etc/fin/fin-migrate.env)
  -h, --help  эта справка
USAGE
}

MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

[ -r "$ENV_FILE" ] || { echo "Нет доступа к $ENV_FILE (права 640 root:docker; см. deploy/README.md)" >&2; exit 1; }

echo "==> [1/6] git pull ($PORTAL_DIR)"
if git -C "$PORTAL_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git -C "$PORTAL_DIR" pull --ff-only
else
  echo "git upstream не настроен — пропускаю pull"
fi

# Тег образа описывает содержимое сборки только при чистом рабочем дереве
if ! git -C "$PORTAL_DIR" diff --quiet || ! git -C "$PORTAL_DIR" diff --cached --quiet; then
  echo "В рабочем каталоге есть незакоммиченные правки — деплой из неопределённого состояния запрещён" >&2
  exit 1
fi
FIN_TAG="$(git -C "$PORTAL_DIR" rev-parse --short HEAD)"
export FIN_TAG

echo "==> [2/6] build (тег $FIN_TAG)"
"${COMPOSE[@]}" build

MIGRATE_STATUS="нет"
if [ "$MIGRATE" = 1 ]; then
  echo "==> [3/6] migrate (роль fin_migration)"
  [ -r "$MIGRATE_ENV_FILE" ] || { echo "Нет доступа к $MIGRATE_ENV_FILE — см. deploy/README.md" >&2; exit 1; }
  MIGRATE_DATABASE_URL="$(grep -E '^MIGRATE_DATABASE_URL=' "$MIGRATE_ENV_FILE" | head -n1 | cut -d= -f2-)"
  [ -n "$MIGRATE_DATABASE_URL" ] || { echo "MIGRATE_DATABASE_URL не задан в $MIGRATE_ENV_FILE" >&2; exit 1; }
  export MIGRATE_DATABASE_URL
  "${COMPOSE[@]}" run --rm migrate
  unset MIGRATE_DATABASE_URL
  MIGRATE_STATUS="да"
else
  echo "==> [3/6] migrate пропущен (флаг --migrate не передан)"
fi

echo "==> [4/6] up"
"${COMPOSE[@]}" up -d fin-api fin-worker fin-web

echo "==> [5/6] health (изнутри контейнера — публичный домен не требуется)"
health_ok=""
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T fin-api wget -qO- http://127.0.0.1:3000/health/ready >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  sleep 2
done

echo "==> [6/6] отчёт"
echo
echo "===== ОТЧЁТ О ДЕПЛОЕ (fin) ====="
echo "время:    $(date -Is)"
echo "коммит:   $(git -C "$PORTAL_DIR" rev-parse HEAD) (тег образа $FIN_TAG)"
echo "миграции: $MIGRATE_STATUS"
echo "health:   $([ -n "$health_ok" ] && echo ok || echo 'НЕ готов — docker compose -p fin logs fin-api')"
"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
echo "================================"

[ -n "$health_ok" ] || exit 1
echo "Готово."
