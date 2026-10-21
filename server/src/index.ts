import fs from 'node:fs/promises';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { checkBinaries } from './services/binaries.js';
import { createApp } from './app.js';

async function main() {
  await fs.mkdir(env.TEMP_DIR, { recursive: true });

  for (const b of await checkBinaries()) {
    if (b.available) logger.info({ version: b.version }, `${b.name} found`);
    else logger.warn(`${b.name} NOT found (${b.error}). ${b.installHint}`);
  }

  await connectMongo(env.MONGO_URI);

  const server = createApp().listen(env.PORT, () => {
    logger.info(`SnapGrab API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await disconnectMongo().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
