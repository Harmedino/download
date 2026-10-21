import mongoose from 'mongoose';
import { logger } from '../logger.js';

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  // Fail fast instead of queueing queries while disconnected; routes surface DB_UNAVAILABLE.
  mongoose.set('bufferCommands', false);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export function mongoState(): 'connected' | 'connecting' | 'disconnected' | 'disconnecting' {
  const states: Array<ReturnType<typeof mongoState>> = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[Number(mongoose.connection.readyState)] ?? 'disconnected';
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
