# Деплой портала «КС» (fin)

Портал разворачивается на общем production-VPS (`backend-vps-1`) рядом с другими порталами
(estimat, billhub, technic, zakupki). Деплой **portal-scoped**: команда `deploy-fin` работает
только с проектом `-p fin` и не должна трогать соседние порталы, `infra-nginx`, Keycloak.

Отступление от корпстандарта §19 (этап 1, как и у соседних порталов на этом VPS): образ
собирается на самой VPS (`git pull` + `docker compose build`), без Container Registry.

## Архитектура на VPS

- Порталы лежат в `/opt/portals/<portal>` (пример: `/opt/portals/estimat`), fin — в
  `/opt/portals/fin`.
- Nginx — контейнер `infra-nginx` (compose-проект `/opt/infra/nginx/docker-compose.yml`),
  конфиги порталов — `/opt/infra/nginx/conf.d/<portal>.conf`. Сертификаты продлевает
  контейнер `infra-certbot`.
- Все контейнеры порталов и `infra-nginx` сидят в общей внешней docker-сети `edge`
  (создана один раз: `docker network create edge`). Портов наружу компоуз fin не публикует —
  единственная точка входа снаружи — `infra-nginx` (80/443), обращается к `fin-api`/`fin-web`
  по DNS-имени сервиса внутри `edge`. Имена сервисов в `edge` уникальны на весь хост —
  `fin-api`/`fin-worker`/`fin-web` заняты только этим порталом.
- Конфиг и секреты — `/etc/fin/fin.env` и `/etc/fin/fin-migrate.env` (640 root:docker), в git
  не попадают.
- Команда `deploy-fin` подключена симлинком в `/usr/local/bin` и работает из любой директории.

Диск на VPS уже занят ~80% (проверьте `df -h /` перед первой сборкой) — при нехватке места
попросите владельца VPS почистить `docker buildx prune` точечно; **не запускайте**
`docker system prune -a` самостоятельно (заденет чужие образы и кэш).

## 1. База данных (существующий кластер Yandex Managed PostgreSQL)

Выполняется владельцем кластера (через консоль/CLI Yandex Cloud или под ролью-владельцем БД):

На backend-vps-1 используется роль **`fin_id`** (и для runtime, и для миграций на этапе 1).
Ниже — вариант для WebSQL / владельца кластера, если БД и пользователь уже созданы:

```sql
-- выполнить, будучи подключенным к БД fin (не к postgres)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

GRANT CONNECT ON DATABASE fin TO fin_id;
GRANT USAGE, CREATE ON SCHEMA public TO fin_id;

-- на уже существующие объекты (если появились до выдачи прав)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fin_id;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fin_id;

-- на будущие объекты, которые создаст сама fin_id (миграции)
ALTER DEFAULT PRIVILEGES FOR ROLE fin_id IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fin_id;
ALTER DEFAULT PRIVILEGES FOR ROLE fin_id IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fin_id;

-- бюджет соединений (§7): api+worker DB_POOL_MAX=10 → до ×2 при rolling ≈ 40
ALTER ROLE fin_id CONNECTION LIMIT 40;
```

Если роли ещё нет / БД ещё нет (владелец кластера):

```sql
CREATE DATABASE fin;
CREATE USER fin_id WITH PASSWORD '...' CONNECTION LIMIT 40;
-- затем \c fin и блок с EXTENSION/GRANT выше
```

Опционально позже можно выделить DDL-роль `fin_migration` и оставить `fin_id` только на DML
(см. исходный dual-role вариант в истории репо) — для первого стенда не обязательно.

## 2. Конфиг и секреты на хосте

```bash
sudo mkdir -p /etc/fin
sudo install -m 640 -o root -g docker deploy/fin.env.example /etc/fin/fin.env
sudo install -m 640 -o root -g docker deploy/fin-migrate.env.example /etc/fin/fin-migrate.env
sudo "${EDITOR:-nano}" /etc/fin/fin.env            # заполнить DATABASE_URL, JWT_SECRET, SEED_ADMIN_*
sudo "${EDITOR:-nano}" /etc/fin/fin-migrate.env    # заполнить MIGRATE_DATABASE_URL
```

CA-сертификат Yandex Managed PostgreSQL (проверить сначала, нет ли уже общего CA на хосте —
у соседних порталов, например `/etc/estimat/`; если есть, скопировать его, а не качать заново):

```bash
sudo curl -o /etc/fin/root.crt https://storage.yandexcloud.net/cloud-certs/CA.pem
sudo chmod 644 /etc/fin/root.crt
```

`JWT_SECRET` — `openssl rand -base64 48` (нужно ≥32 символа, без подстроки `dev-secret` —
проверяется на старте, см. `backend/src/config.ts`).

## 3. Код на сервере и симлинк команды

```bash
sudo git clone https://github.com/saztonov/fin /opt/portals/fin
sudo ln -sf /opt/portals/fin/deploy/deploy-fin.sh /usr/local/bin/deploy-fin
```

## 4. Первый запуск

```bash
deploy-fin --migrate
docker compose -f /opt/portals/fin/deploy/docker-compose.prod.yml -p fin run --rm seed
```

После успешного сида закомментируйте `SEED_ADMIN_PASSWORD` в `/etc/fin/fin.env` — значение
больше не требуется, а первый администратор сможет сменить пароль сам.

## 5. Обновление

```bash
deploy-fin              # без новых миграций
deploy-fin --migrate    # с новыми миграциями
```

Откат — вручную: `git -C /opt/portals/fin checkout <старый SHA> && deploy-fin` (без `--migrate`;
down-миграций в проекте нет — откат схемы БД не автоматизирован).

## 6. Подключение домена (когда будет выбран)

1. Направить DNS A-запись домена на публичный IP VPS.
2. Прописать `FIN_DOMAIN=<домен>` в `/etc/fin/fin.env`.
3. Выпустить сертификат (webroot уже обслуживается контейнером `infra-certbot`):
   ```bash
   docker exec infra-certbot certbot certonly --webroot -w /var/www/certbot -d <домен>
   ```
4. Отрендерить и подключить конфиг:
   ```bash
   FIN_DOMAIN=<домен> envsubst '$FIN_DOMAIN' \
     < /opt/portals/fin/deploy/nginx/fin.conf.template \
     | sudo tee /opt/infra/nginx/conf.d/fin.conf >/dev/null
   docker exec infra-nginx nginx -t && docker exec infra-nginx nginx -s reload
   ```

## Запреты (§19)

Деплой одного портала не должен задевать остальные. На этом хосте **никогда**:
- `docker system prune -a`, `docker stop $(docker ps -q)` — заденут все порталы;
- `docker compose -p fin down --volumes` — уничтожит том `fin_uploads` с файлами импорта;
- правки чужих файлов в `/opt/infra/nginx/conf.d/` или каталогов соседних порталов в
  `/opt/portals/`.

## Backup

- БД — managed-бэкапы Yandex Cloud (настраиваются на кластере, не в этом репозитории).
- Файлы импорта (том `fin_uploads`):
  ```bash
  docker run --rm -v fin_uploads:/data -v "$PWD":/backup alpine \
    tar czf /backup/fin-uploads-$(date +%Y%m%d).tar.gz -C /data .
  ```
- `/etc/fin/` — конфиг и CA, копировать вручную при подготовке аварийного восстановления
  (файл содержит секреты — хранить копию так же защищённо, права не ослаблять).
