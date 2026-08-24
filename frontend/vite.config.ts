import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Один идентификатор на сборку: вшивается в бандл (__BUILD_ID__) и кладётся в dist/version.json.
// В рантайме хук сравнивает их и предлагает обновиться, если вкладка работает на старом бандле.
// Слой `RUN npm run build -w frontend` в frontend/Dockerfile инвалидируется только при изменении
// frontend/, поэтому новый ID появляется ровно тогда, когда фронт реально пересобран: чисто
// бэкендовый деплой плашку не поднимет. Переменная BUILD_ID — аварийный override.
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString();

const versionFilePlugin = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ buildId: BUILD_ID }),
    });
  },
});

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/health': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  // карты исходников не должны попадать в прод-раздачу (собранный dist уезжает в образ fin-web)
  build: { outDir: 'dist', sourcemap: false },
});
