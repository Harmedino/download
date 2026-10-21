import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requireDb } from './middleware/requireDb.js';
import { limits } from './middleware/rateLimit.js';
import { fetchRouter } from './routes/fetch.js';
import { downloadRouter } from './routes/download.js';
import { jobsRouter } from './routes/jobs.js';
import { filesRouter } from './routes/files.js';
import { removeBgRouter } from './routes/removeBg.js';
import { identifyOwner } from './middleware/owner.js';
import { configRouter } from './routes/config.js';
import { historyRouter } from './routes/history.js';
import { mediaRouter } from './routes/media.js';
import { toolsRouter } from './routes/tools.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // JSON + file API: nothing here should ever execute or be framed.
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      // The Angular app on another origin embeds previews from /api/files.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Client-Id'],
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' || !!req.url?.startsWith('/api/jobs/') },
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    }),
  );
  app.use('/api', limits.api());
  app.use('/api', identifyOwner);

  app.use('/api/health', healthRouter);
  app.use('/api/fetch', requireDb, limits.fetch(), fetchRouter);
  app.use('/api/download', requireDb, limits.download(), downloadRouter);
  app.use('/api/remove-bg', requireDb, removeBgRouter); // per-endpoint limits inside, before the upload
  app.use('/api/jobs', requireDb, limits.jobs(), jobsRouter);
  app.use('/api/files', requireDb, limits.files(), filesRouter);
  app.use('/api/config', configRouter);
  app.use('/api/media', requireDb, mediaRouter); // upload limit inside, before multer
  app.use(['/api/tools/subtitles', '/api/tools/creator-pack'], limits.ai());
  app.use('/api/tools', requireDb, limits.tools(), toolsRouter);
  app.use('/api/history', requireDb, limits.jobs(), historyRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
