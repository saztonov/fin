# Статика портала «КС»: SPA собирается Vite и раздаётся nginx с того же origin, что и API
# (фронт ходит на same-origin /api/v1 — build-args не нужны). Build context = корень монорепо:
#   docker build -f frontend/Dockerfile -t fin-web ..

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --include-workspace-root=false --ignore-scripts
COPY frontend frontend
RUN npm run build -w frontend

FROM nginx:alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
