import { env } from './config/env.js';
import { logger } from './logger.js';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { checkBinaries } from './services/binaries.js';
import { createApp } from './app.js';
import { startAgenda, stopAgenda } from './jobs/agenda.js';
import { ensureStorageDirs } from './services/storage.js';

async function main() {
  await ensureStorageDirs();

  for (const b of await checkBinaries()) {
    if (b.available) logger.info({ version: b.version }, `${b.name} found`);
    else logger.warn(`${b.name} NOT found (${b.error}). ${b.installHint}`);
  }

  try {
    await connectMongo(env.MONGO_URI);
  } catch (err) {
    // Never log the full URI: it usually contains the database password.
    const host = env.MONGO_URI.replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split(/[/?]/)[0];
    logger.fatal(
      { reason: (err as Error).message },
      `Could not connect to MongoDB at ${host}. Check MONGO_URI, and on MongoDB Atlas allow your host's IP ` +
        '(Network Access, 0.0.0.0/0 for Render/Railway) and verify the database user and password.',
    );
    process.exit(1);
  }
  await startAgenda();

  const server = createApp().listen(env.PORT, () => {
    logger.info(`SnapGrab API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await stopAgenda().catch(() => undefined);
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
