import mongoose from 'mongoose';
import { Admin, Entry, Site, Worker } from './models';

let connectionPromise: Promise<typeof mongoose> | null = null;
let schemaPromise: Promise<unknown[]> | null = null;

async function ensureIndexes() {
  if (!schemaPromise) {
    schemaPromise = Promise.all([
      Admin.init(),
      Worker.init(),
      Site.init(),
      Entry.init()
    ]).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  if (mongoose.connection.readyState !== 1) {
    if (!connectionPromise) {
      connectionPromise = mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10
      }).catch((error) => {
        connectionPromise = null;
        throw error;
      });
    }
    await connectionPromise;
  }

  await ensureIndexes();
}
