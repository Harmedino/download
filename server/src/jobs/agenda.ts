import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import mongoose from 'mongoose';
import type { Types } from 'mongoose';
import { logger } from '../logger.js';
import type { JobType } from '../models/Job.js';
import { processCleanup } from './processors/cleanup.js';
import { processDownload } from './processors/download.js';

export type QueueName = Exclude<JobType, 'fetch'> | 'cleanup-files';

let agenda: Agenda | null = null;

export async function startAgenda(): Promise<Agenda> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB must be connected before starting Agenda');

  agenda = new Agenda({
    name: `snapgrab-${process.pid}`,
    backend: new MongoBackend({ mongo: db, collection: 'agendaJobs' }),
    processEvery: '2 seconds',
    maxConcurrency: 8,
    defaultLockLifetime: 15 * 60_000,
  });

  agenda.define('download', processDownload, { concurrency: 3, removeOnComplete: true });
  agenda.define('cleanup-files', processCleanup, { concurrency: 1 });

  agenda.on('error', (err: unknown) => logger.error({ err }, 'Agenda error'));
  await agenda.start();
  await agenda.every('10 minutes', 'cleanup-files');
  logger.info('Agenda started');
  return agenda;
}

export async function enqueue(name: QueueName, jobId: Types.ObjectId | string): Promise<void> {
  if (!agenda) throw new Error('Agenda is not running');
  await agenda.now(name, { jobId: String(jobId) });
}

export async function stopAgenda(): Promise<void> {
  await agenda?.stop();
}

export function getAgenda(): Agenda | null {
  return agenda;
}
