import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
