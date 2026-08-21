# Статика портала «КС»: SPA собирается Vite и раздаётся nginx с того же origin, что и API
# (фронт ходит на same-origin /api/v1 — build-args не нужны). Build context = корень монорепо:
#   docker build -f frontend/Dockerfile -t fin-web ..

FROM node:24-alpine AS build
WORKDIR /app
# Потолок кучи — см. комментарий в backend/Dockerfile. Здесь выше: `npm run build` — это
# `tsc --noEmit && vite build`, и rollup при бандлинге antd прожорливее tsc. Процессы идут
# последовательно, так что пик — один процесс за раз. Если упрётся («JavaScript heap out of
# memory») — поднимать значение, а не убирать ENV: провалившаяся сборка безопаснее, чем
# сборка без потолка, которая уводит VPS в thrashing.
ENV NODE_OPTIONS=--max-old-space-size=1536
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
