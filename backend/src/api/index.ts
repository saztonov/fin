import { loadConfig } from '../config.js';
import { buildServer } from './server.js';

const cfg = loadConfig();
const app = await buildServer();

// graceful shutdown (корпстандарт §5)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'останов API');
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
