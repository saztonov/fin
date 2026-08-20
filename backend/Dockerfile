# Один образ, три команды: api | worker | migrate (корпстандарт §19: immutable image, без git pull/npm install на VPS)
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --include-workspace-root=false --omit=dev --ignore-scripts \
    && cp -R node_modules /prod_node_modules \
    && npm ci --workspace backend --include-workspace-root=false --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY backend backend
COPY package.json ./
RUN cd backend && npx tsc -p tsconfig.build.json

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S ks && adduser -S ks -G ks
COPY --from=deps /prod_node_modules node_modules
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
COPY backend/package.json backend/package.json
USER ks
WORKDIR /app/backend
# api:     node dist/api/index.js
# worker:  node dist/worker/index.js
# migrate: node dist/scripts/migrate.js
CMD ["node", "dist/api/index.js"]
