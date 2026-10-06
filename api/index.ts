import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

let dbPromise: Promise<typeof mongoose> | null = null;

async function db() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2 && dbPromise) {
    await dbPromise;
    return;
  }
  dbPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await dbPromise;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
}

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const workerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  pinHash: { type: String, required: true, select: false },
  pinKey: { type: String, required: true, unique: true, select: false },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const siteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const entrySchema = new mongoose.Schema({
  workerId: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true },
  site: { type: String, required: true },
  start: { type: String, default: null },
  end: { type: String, default: null },
  regular: { type: Number, required: true, default: 0 },
  overtime: { type: Number, required: true, default: 0 }
}, { timestamps: true });

entrySchema.index({ workerId: 1, date: 1 }, { unique: true });

const Admin: any = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
const Worker: any = mongoose.models.Worker || mongoose.model('Worker', workerSchema);
const Site: any = mongoose.models.Site || mongoose.model('Site', siteSchema);
const Entry: any = mongoose.models.Entry || mongoose.model('Entry', entrySchema);

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayInAthens() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function parseTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function hoursFor(date: string, start?: string | null, end?: string | null) {
  if (dayOfWeek(date) === 0) return { start: null, end: null, regular: 0, overtime: 0 };

  const startMinutes = start ? parseTime(start) : null;
  const endMinutes = end ? parseTime(end) : null;
  if (startMinutes === null || endMinutes === null) {
    throw Object.assign(new Error('Start and finish time are required.'), { code: 'TIME_REQUIRED', status: 400 });
  }
  if (endMinutes <= startMinutes) {
    throw Object.assign(new Error('Finish time must be later than start time.'), { code: 'INVALID_TIME_RANGE', status: 400 });
  }

  const regularStart = 8 * 60;
  const regularEnd = dayOfWeek(date) === 6 ? 15 * 60 : 16 * 60;
  const totalMinutes = endMinutes - startMinutes;
  const regularMinutes = Math.max(0, Math.min(endMinutes, regularEnd) - Math.max(startMinutes, regularStart));
  const overtimeMinutes = Math.max(0, totalMinutes - regularMinutes);

  return {
    start,
    end,
    regular: Number((regularMinutes / 60).toFixed(2)),
    overtime: Number((overtimeMinutes / 60).toFixed(2))
  };
}

function jwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 24) throw new Error('JWT_SECRET is not configured securely');
  return value;
}

function workerPinKey(pin: string) {
  return createHmac('sha256', jwtSecret()).update(`worktime-worker-pin:${pin}`).digest('hex');
}

function fail(res: any, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
}

function handleRouteError(res: any, error: any) {
  if (error?.status && error?.code) return fail(res, error.status, error.code, error.message || 'Request failed.');
  if (error?.code === 11000) return fail(res, 409, 'DUPLICATE_VALUE', 'This value is already in use.');
  console.error(error);
  return fail(res, 500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
}

function auth(req: any, res: any, next: any) {
  try {
    const header = text(req.headers.authorization);
    if (!header.startsWith('Bearer ')) return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
    req.user = jwt.verify(header.slice(7), jwtSecret());
    next();
  } catch {
    return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
  }
}

function admin(req: any, res: any, next: any) {
  auth(req, res, () => {
    if (req.user?.role !== 'admin') return fail(res, 403, 'ADMIN_ONLY', 'Administrator access is required.');
    next();
  });
}

async function enrichEntries(entries: any[]) {
  const [sites, workers] = await Promise.all([
    Site.find().lean(),
    Worker.find().select('name active').lean()
  ]);
  const siteMap = Object.fromEntries(sites.map((site: any) => [String(site._id), site.name]));
  const workerMap = Object.fromEntries(workers.map((worker: any) => [String(worker._id), worker]));

  return entries.map((entry: any) => {
    const worker = workerMap[entry.workerId];
    return {
      ...entry,
      siteName: siteMap[entry.site] || 'Unknown site',
      workerName: worker?.name || 'Unknown worker',
      workerActive: worker?.active ?? false
    };
  });
}

function validateDate(date: string) {
  if (!isValidDate(date)) {
    throw Object.assign(new Error('Please choose a valid date.'), { code: 'INVALID_DATE', status: 400 });
  }
  if (date > todayInAthens()) {
    throw Object.assign(new Error('Future dates are not allowed.'), { code: 'FUTURE_DATE', status: 400 });
  }
}

async function ensureSite(siteId: string, mustBeActive: boolean) {
  if (!validId(siteId)) {
    throw Object.assign(new Error('Please choose a valid work site.'), { code: 'INVALID_SITE', status: 400 });
  }
  const site = await Site.findById(siteId);
  if (!site || (mustBeActive && !site.active)) {
    throw Object.assign(new Error('The selected work site is not available.'), { code: 'SITE_UNAVAILABLE', status: 400 });
  }
  return site;
}

async function bootstrapOrLoginAdmin(email: string, password: string) {
  const hasAdmin = await Admin.exists({});

  if (!hasAdmin) {
    const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const configuredPassword = process.env.ADMIN_PASSWORD || '';
    if (!configuredEmail || !configuredPassword) {
      throw Object.assign(new Error('Admin login is not configured.'), { code: 'ADMIN_NOT_CONFIGURED', status: 500 });
    }
    if (email !== configuredEmail || password !== configuredPassword) {
      throw Object.assign(new Error('Incorrect email or password.'), { code: 'INVALID_CREDENTIALS', status: 401 });
    }

    try {
      const created = await Admin.create({
        email: configuredEmail,
        passwordHash: await bcrypt.hash(configuredPassword, 12),
        active: true
      });
      return created;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  const account = await Admin.findOne({ email, active: true }).select('+passwordHash');
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    throw Object.assign(new Error('Incorrect email or password.'), { code: 'INVALID_CREDENTIALS', status: 401 });
  }
  return account;
}

async function findWorkerByPin(pin: string) {
  const key = workerPinKey(pin);
  let worker = await Worker.findOne({ pinKey: key, active: true }).select('+pinHash +pinKey');
  if (worker && await bcrypt.compare(pin, worker.pinHash)) return worker;

  // Compatibility path for old records or a rotated lookup secret.
  const candidates = await Worker.find({ active: true }).select('+pinHash +pinKey');
  for (const candidate of candidates) {
    if (candidate.pinHash && await bcrypt.compare(pin, candidate.pinHash)) {
      candidate.pinKey = key;
      await candidate.save();
      return candidate;
    }
  }
  return null;
}

app.get('/api/health', async (_req, res) => {
  try {
    await db();
    if (mongoose.connection.readyState !== 1) {
      return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database is not connected.');
    }
    return res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'DATABASE_UNAVAILABLE', 'Database connection failed.');
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    await db();
    const body = req.body || {};

    if (body.role === 'admin') {
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      if (!email || !password) return fail(res, 400, 'LOGIN_FIELDS_REQUIRED', 'Email and password are required.');
      const account = await bootstrapOrLoginAdmin(email, password);
      return res.json({
        role: 'admin',
        token: jwt.sign({ role: 'admin', id: String(account._id) }, jwtSecret(), { expiresIn: '12h' })
      });
    }

    if (body.role !== 'worker') return fail(res, 400, 'INVALID_ROLE', 'Please choose a valid login type.');
    const pin = String(body.pin || '');
    if (!pin) return fail(res, 400, 'LOGIN_FIELDS_REQUIRED', 'PIN is required.');
    if (!/^\d{4,12}$/.test(pin)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect PIN.');

    const worker = await findWorkerByPin(pin);
    if (!worker) return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect PIN.');

    return res.json({
      role: 'worker',
      token: jwt.sign({ role: 'worker', id: String(worker._id) }, jwtSecret(), { expiresIn: '30d' })
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.get('/api/sites', auth, async (_req: any, res) => {
  try {
    await db();
    return res.json(await Site.find({ active: true }).sort({ name: 1 }).lean());
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.get('/api/entries', auth, async (req: any, res) => {
  try {
    await db();
    const query = req.user.role === 'worker' ? { workerId: req.user.id } : {};
    const limit = req.user.role === 'worker' ? 30 : 5000;
    const entries = await Entry.find(query).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
    return res.json(await enrichEntries(entries));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.post('/api/entries', auth, async (req: any, res) => {
  try {
    await db();
    if (req.user.role !== 'worker') return fail(res, 403, 'WORKER_ONLY', 'Worker access is required.');
    const worker = await Worker.findOne({ _id: req.user.id, active: true });
    if (!worker) return fail(res, 403, 'WORKER_DISABLED', 'This worker account is disabled.');

    const date = text(req.body?.date);
    const site = text(req.body?.site);
    validateDate(date);
    await ensureSite(site, true);

    const existing = await Entry.findOne({ workerId: req.user.id, date }).select('_id').lean();
    if (existing) return fail(res, 409, 'ENTRY_EXISTS', 'You already submitted an entry for this date. Ask the administrator to correct it if needed.');

    const calculated = hoursFor(date, text(req.body?.start) || null, text(req.body?.end) || null);
    const entry = await Entry.create({ workerId: req.user.id, date, site, ...calculated });
    return res.status(201).json(entry);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.get('/api/admin/workers', admin, async (_req, res) => {
  try {
    await db();
    return res.json(await Worker.find().select('name active createdAt updatedAt').sort({ active: -1, name: 1 }).lean());
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.post('/api/admin/workers', admin, async (req, res) => {
  try {
    await db();
    const name = text(req.body?.name);
    const pin = String(req.body?.pin || '');
    if (name.length < 2 || name.length > 80) return fail(res, 400, 'INVALID_WORKER_NAME', 'Worker name must be between 2 and 80 characters.');
    if (!/^\d{4,12}$/.test(pin)) return fail(res, 400, 'INVALID_PIN', 'PIN must contain 4–12 digits.');

    const pinKey = workerPinKey(pin);
    if (await Worker.findOne({ pinKey }).select('_id').lean()) {
      return fail(res, 409, 'PIN_EXISTS', 'This PIN is already assigned to another worker.');
    }

    const worker = await Worker.create({
      name,
      pinHash: await bcrypt.hash(pin, 12),
      pinKey,
      active: true
    });
    return res.status(201).json({ _id: worker._id, name: worker.name, active: worker.active });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.patch('/api/admin/workers/:id', admin, async (req, res) => {
  try {
    await db();
    if (!validId(req.params.id)) return fail(res, 400, 'INVALID_WORKER', 'Worker was not found.');
    const worker = await Worker.findById(req.params.id).select('+pinHash +pinKey');
    if (!worker) return fail(res, 404, 'WORKER_NOT_FOUND', 'Worker was not found.');

    if (req.body?.name !== undefined) {
      const name = text(req.body.name);
      if (name.length < 2 || name.length > 80) return fail(res, 400, 'INVALID_WORKER_NAME', 'Worker name must be between 2 and 80 characters.');
      worker.name = name;
    }

    if (req.body?.pin) {
      const pin = String(req.body.pin);
      if (!/^\d{4,12}$/.test(pin)) return fail(res, 400, 'INVALID_PIN', 'PIN must contain 4–12 digits.');
      const pinKey = workerPinKey(pin);
      const duplicate = await Worker.findOne({ pinKey, _id: { $ne: worker._id } }).select('_id').lean();
      if (duplicate) return fail(res, 409, 'PIN_EXISTS', 'This PIN is already assigned to another worker.');
      worker.pinHash = await bcrypt.hash(pin, 12);
      worker.pinKey = pinKey;
    }

    if (typeof req.body?.active === 'boolean') worker.active = req.body.active;
    await worker.save();
    return res.json({ _id: worker._id, name: worker.name, active: worker.active });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.get('/api/admin/sites', admin, async (_req, res) => {
  try {
    await db();
    return res.json(await Site.find().sort({ active: -1, name: 1 }).lean());
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.post('/api/admin/sites', admin, async (req, res) => {
  try {
    await db();
    const name = text(req.body?.name);
    if (name.length < 2 || name.length > 80) return fail(res, 400, 'INVALID_SITE_NAME', 'Site name must be between 2 and 80 characters.');
    const duplicate = await Site.findOne({ name }).select('_id').lean();
    if (duplicate) return fail(res, 409, 'SITE_EXISTS', 'This site already exists.');
    return res.status(201).json(await Site.create({ name, active: true }));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.patch('/api/admin/sites/:id', admin, async (req, res) => {
  try {
    await db();
    if (!validId(req.params.id)) return fail(res, 400, 'INVALID_SITE', 'Site was not found.');
    const site = await Site.findById(req.params.id);
    if (!site) return fail(res, 404, 'SITE_NOT_FOUND', 'Site was not found.');

    if (req.body?.name !== undefined) {
      const name = text(req.body.name);
      if (name.length < 2 || name.length > 80) return fail(res, 400, 'INVALID_SITE_NAME', 'Site name must be between 2 and 80 characters.');
      const duplicate = await Site.findOne({ name, _id: { $ne: site._id } }).select('_id').lean();
      if (duplicate) return fail(res, 409, 'SITE_EXISTS', 'This site already exists.');
      site.name = name;
    }

    if (typeof req.body?.active === 'boolean') site.active = req.body.active;
    await site.save();
    return res.json(site);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

app.patch('/api/admin/entries/:id', admin, async (req, res) => {
  try {
    await db();
    if (!validId(req.params.id)) return fail(res, 400, 'INVALID_ENTRY', 'Timesheet entry was not found.');
    const entry = await Entry.findById(req.params.id);
    if (!entry) return fail(res, 404, 'ENTRY_NOT_FOUND', 'Timesheet entry was not found.');

    const date = text(req.body?.date || entry.date);
    const site = text(req.body?.site || entry.site);
    validateDate(date);
    await ensureSite(site, false);

    const duplicate = await Entry.findOne({ workerId: entry.workerId, date, _id: { $ne: entry._id } }).select('_id').lean();
    if (duplicate) return fail(res, 409, 'ENTRY_EXISTS', 'This worker already has an entry for that date.');

    const calculated = hoursFor(date, text(req.body?.start) || null, text(req.body?.end) || null);
    entry.date = date;
    entry.site = site;
    entry.start = calculated.start;
    entry.end = calculated.end;
    entry.regular = calculated.regular;
    entry.overtime = calculated.overtime;
    await entry.save();

    const [enriched] = await enrichEntries([entry.toObject()]);
    return res.json(enriched);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

export default app;
