import { Entry, mongoose, Worker } from './models';

let connectionPromise: Promise<typeof mongoose> | null = null;
let migrationPromise: Promise<void> | null = null;

async function migrateLegacyWorkerSchema() {
  const indexes = await Worker.collection.indexes();

  for (const index of indexes) {
    const key = index.key as Record<string, number> | undefined;
    if (key?.workerCode === 1 && index.name) {
      await Worker.collection.dropIndex(index.name).catch((error: any) => {
        if (error?.codeName !== 'IndexNotFound') throw error;
      });
    }
  }

  const currentPinIndex = indexes.find((index) => index.name === 'pinKey_1');
  if (currentPinIndex && !currentPinIndex.sparse) {
    await Worker.collection.dropIndex('pinKey_1').catch((error: any) => {
      if (error?.codeName !== 'IndexNotFound') throw error;
    });
  }

  await Worker.collection.createIndex(
    { pinKey: 1 },
    { unique: true, sparse: true, name: 'pinKey_1' }
  );

  await Worker.collection.updateMany(
    { workerCode: { $exists: true } },
    { $unset: { workerCode: '' } }
  );

  await Entry.collection.createIndex(
    { workerId: 1, date: 1 },
    { unique: true, name: 'workerId_1_date_1' }
  );
}

async function ensureDatabaseShape() {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyWorkerSchema().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  await migrationPromise;
}

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  if (mongoose.connection.readyState === 1) {
    await ensureDatabaseShape();
    return;
  }

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
  await ensureDatabaseShape();
}
