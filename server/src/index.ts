import { env } from './config/env.js';
import { logger } from './logger.js';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { checkBinaries } from './services/binaries.js';
import { createApp } from './app.js';
import { startAgenda, stopAgenda } from './jobs/agenda.js';
import { ensureRateLimitIndexes } from './middleware/rateLimit.js';
import { ensureStorageDirs } from './services/storage.js';

const MONGO_RETRY_MS = 15_000;

/** Connects to MongoDB, retrying until it succeeds, then starts what depends on it. */
async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await connectMongo(env.MONGO_URI);
      break;
    } catch (err) {
      // Never log the full URI: it usually contains the database password.
      const host = env.MONGO_URI.replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split(/[/?]/)[0];
      logger.error(
        { reason: (err as Error).message },
        `Could not connect to MongoDB at ${host}; retrying in ${MONGO_RETRY_MS / 1000}s. Check MONGO_URI, and on MongoDB Atlas ` +
          "allow your host's IP (Network Access, 0.0.0.0/0 for Render/Railway) and verify the database user and password.",
      );
      await new Promise((r) => setTimeout(r, MONGO_RETRY_MS));
    }
  }
  try {
    await ensureRateLimitIndexes();
    await startAgenda();
  } catch (err) {
    logger.fatal({ err }, 'Failed to start background jobs');
    process.exit(1);
  }
}

async function main() {
  await ensureStorageDirs();

  for (const b of await checkBinaries()) {
    if (b.available) logger.info({ version: b.version }, `${b.name} found`);
    else logger.warn(`${b.name} NOT found (${b.error}). ${b.installHint}`);
  }

  // Listen before MongoDB is up so /api/health answers and routes return DB_UNAVAILABLE (with CORS
  // headers) instead of the browser seeing a dead host while the database is unreachable.
  const server = createApp().listen(env.PORT, () => {
    logger.info(`SnapGrab API listening on http://localhost:${env.PORT}`);
    logger.info({ origins: env.CLIENT_ORIGIN }, 'CORS allows these client origins');
  });

  void connectWithRetry();

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
