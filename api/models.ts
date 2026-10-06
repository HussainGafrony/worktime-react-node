import { model, models, Schema, type Model, type Types } from 'mongoose';

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

export interface EntryRecord {
  workerId: Types.ObjectId;
  date: string;
  site: Types.ObjectId;
  start: string | null;
  end: string | null;
  regular: number;
  overtime: number;
}

const commonOptions = {
  timestamps: true,
  versionKey: false,
  strict: true
} as const;

const adminSchema = new Schema<AdminRecord>({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 254
  },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true, required: true }
}, commonOptions);

const workerSchema = new Schema<WorkerRecord>({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 80
  },
  pinHash: { type: String, required: true, select: false },
  pinKey: {
    type: String,
    required: true,
    unique: true,
    select: false,
    minlength: 64,
    maxlength: 64
  },
  active: { type: Boolean, default: true, required: true }
}, commonOptions);

const siteSchema = new Schema<SiteRecord>({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 80
  },
  nameKey: {
    type: String,
    required: true,
    unique: true,
    select: false,
    maxlength: 80
  },
  active: { type: Boolean, default: true, required: true }
}, commonOptions);

const entrySchema = new Schema<EntryRecord>({
  workerId: {
    type: Schema.Types.ObjectId,
    ref: 'Worker',
    required: true,
    index: true
  },
  date: {
    type: String,
    required: true,
    index: true,
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  site: {
    type: Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },
  start: { type: String, default: null, match: /^\d{2}:\d{2}$/ },
  end: { type: String, default: null, match: /^\d{2}:\d{2}$/ },
  regular: { type: Number, required: true, default: 0, min: 0 },
  overtime: { type: Number, required: true, default: 0, min: 0 }
}, commonOptions);

entrySchema.index({ workerId: 1, date: 1 }, { unique: true });

export const Admin = (models.Admin as Model<AdminRecord> | undefined) ?? model<AdminRecord>('Admin', adminSchema);
export const Worker = (models.Worker as Model<WorkerRecord> | undefined) ?? model<WorkerRecord>('Worker', workerSchema);
export const Site = (models.Site as Model<SiteRecord> | undefined) ?? model<SiteRecord>('Site', siteSchema);
export const Entry = (models.Entry as Model<EntryRecord> | undefined) ?? model<EntryRecord>('Entry', entrySchema);
