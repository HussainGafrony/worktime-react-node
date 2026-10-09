import mongoose, { type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { AppError, text } from './errors';

const schemaOptions = { timestamps: true, versionKey: false, strict: true } as const;

export interface AdminRecord {
  email: string;
  passwordHash: string;
  active: boolean;
}

export interface WorkerRecord {
  name: string;
  pinHash: string;
  pinKey: string;
  active: boolean;
}

export interface SiteRecord {
  name: string;
  nameKey: string;
  active: boolean;
}

export interface SessionRecord {
  tokenHash: string;
  role: 'admin' | 'worker';
  accountId: mongoose.Types.ObjectId;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EntryRecord {
  workerId: mongoose.Types.ObjectId;
  workerNameSnapshot?: string;
  date: string;
  site: mongoose.Types.ObjectId;
  siteNameSnapshot?: string;
  start: string | null;
  end: string | null;
  regular: number;
  overtime: number;
  submittedAt: Date;
  isLate: boolean;
  adminNote: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const adminSchema = new mongoose.Schema<AdminRecord>({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true, required: true }
}, schemaOptions);

const workerSchema = new mongoose.Schema<WorkerRecord>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  pinHash: { type: String, required: true, select: false },
  pinKey: { type: String, required: true, unique: true, select: false, minlength: 64, maxlength: 64 },
  active: { type: Boolean, default: true, required: true }
}, schemaOptions);

const siteSchema = new mongoose.Schema<SiteRecord>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  nameKey: { type: String, required: true, unique: true, select: false, maxlength: 80 },
  active: { type: Boolean, default: true, required: true }
}, schemaOptions);

const sessionSchema = new mongoose.Schema<SessionRecord>({
  tokenHash: { type: String, required: true, unique: true, index: true, minlength: 64, maxlength: 64 },
  role: { type: String, required: true, enum: ['admin', 'worker'], index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, schemaOptions);

const entrySchema = new mongoose.Schema<EntryRecord>({
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true, index: true },
  workerNameSnapshot: { type: String, trim: true, maxlength: 80 },
  date: { type: String, required: true, index: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  siteNameSnapshot: { type: String, trim: true, maxlength: 80 },
  start: { type: String, default: null, match: /^\d{2}:\d{2}$/ },
  end: { type: String, default: null, match: /^\d{2}:\d{2}$/ },
  regular: { type: Number, required: true, default: 0, min: 0 },
  overtime: { type: Number, required: true, default: 0, min: 0 },
  submittedAt: { type: Date, required: true, default: Date.now },
  isLate: { type: Boolean, required: true, default: false },
  adminNote: { type: String, required: true, default: '', maxlength: 500 }
}, schemaOptions);
entrySchema.index({ workerId: 1, date: 1 }, { unique: true });
entrySchema.index({ date: -1, workerId: 1 });
entrySchema.index({ site: 1, date: -1 });
entrySchema.index({ isLate: 1, date: -1 });

export const Admin = (mongoose.models.Admin as Model<AdminRecord>) || mongoose.model<AdminRecord>('Admin', adminSchema);
export const Worker = (mongoose.models.Worker as Model<WorkerRecord>) || mongoose.model<WorkerRecord>('Worker', workerSchema);
export const Site = (mongoose.models.Site as Model<SiteRecord>) || mongoose.model<SiteRecord>('Site', siteSchema);
export const Entry = (mongoose.models.Entry as Model<EntryRecord>) || mongoose.model<EntryRecord>('Entry', entrySchema);
export const Session = (mongoose.models.Session as Model<SessionRecord>) || mongoose.model<SessionRecord>('Session', sessionSchema);

let connectionPromise: Promise<typeof mongoose> | null = null;

export function databaseName() {
  return mongoose.connection.name || '';
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

async function ensureInitialAdmin() {
  if (await Admin.exists({})) return;

  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = String(process.env.ADMIN_PASSWORD ?? '');

  if (!email || !password) {
    throw new AppError(500, 'ADMIN_NOT_CONFIGURED', 'Initial admin is not configured.');
  }

  if (password.length < 10) {
    throw new AppError(500, 'ADMIN_NOT_CONFIGURED', 'Initial admin password must be at least 10 characters.');
  }

  try {
    await Admin.create({
      email,
      passwordHash: await bcrypt.hash(password, 12),
      active: true
    });
  } catch (error: unknown) {
    const mongoError = error as { code?: number };
    if (mongoError.code !== 11000) throw error;
  }
}

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new AppError(500, 'DATABASE_UNAVAILABLE', 'MONGODB_URI is not configured.');

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

  await ensureInitialAdmin();
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

export function objectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}
