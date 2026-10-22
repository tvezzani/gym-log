import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPool } from './db.js';

async function main() {
  const config = readConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    await pool.query('SELECT 1');
  } catch {
    await pool.end();
    throw new Error(
      'Database unavailable; run npm run db:up and npm run db:migrate',
    );
  }
  const server = createApp().listen(config.PORT, config.HOST, () => {
    console.log(`API listening on http://${config.HOST}:${config.PORT}`);
  });
  const shutdown = () => {
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => {
      void pool.end().then(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', () => {
    console.error('API listener failed');
    shutdown();
  });
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'API startup failed');
  process.exitCode = 1;
});
