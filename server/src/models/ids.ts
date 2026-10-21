import crypto from 'node:crypto';
import { Types } from 'mongoose';

/**
 * Job and file ids are handed to browsers and act as access tokens for downloads.
 * Default ObjectIds are timestamp + counter and easy to guess, so use 96 random bits instead.
 */
export function randomObjectId(): Types.ObjectId {
  return new Types.ObjectId(crypto.randomBytes(12).toString('hex'));
}
