import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createHmac } from 'node:crypto';
import { connectDatabase } from './database';
import { Admin, Entry, Site, Worker } from './models';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

type Role = 'admin' | 'worker';
type AuthClaims = JwtPayload & { role: Role; id: string };
type AuthenticatedRequest = Request & { user: AuthClaims };

class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function normalizeSiteName(value: unknown) {
  return text(value).replace(/\s+/g, ' ');
}

function siteNameKey(value: unknown) {
  return normalizeSiteName(value).toLowerCase();
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
  if (dayOfWeek(date) === 0) {
    return { start: null, end: null, regular: 0, overtime: 0 };
  }

  const startMinutes = start ? parseTime(start) : null;
  const endMinutes = end ? parseTime(end) : null;
  if (startMinutes === null || endMinutes === null) {
    throw new AppError(400, 'TIME_REQUIRED', 'Start and finish time are required.');
  }
  if (endMinutes <= startMinutes) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'Finish time must be later than start time.');
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
  return createHmac('sha256', jwtSecret())
    .update(`worktime-worker-pin:${pin}`)
    .digest('hex');
}

function fail(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
}

async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = text(req.headers.authorization);
    if (!header.startsWith('Bearer ')) {
      return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
    }

    const decoded = jwt.verify(header.slice(7), jwtSecret());
    if (
      typeof decoded === 'string' ||
      (decoded.role !== 'admin' && decoded.role !== 'worker') ||
      typeof decoded.id !== 'string' ||
      !validId(decoded.id)
    ) {
      return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
    }

    await connectDatabase();
    const accountExists = decoded.role === 'admin'
      ? await Admin.exists({ _id: decoded.id, active: true })
      : await Worker.exists({ _id: decoded.id, active: true });

    if (!accountExists) {
      return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
    }

    (req as AuthenticatedRequest).user = decoded as AuthClaims;
    next();
  } catch {
    return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthenticatedRequest).user.role !== 'admin') {
    return fail(res, 403, 'ADMIN_ONLY', 'Administrator access is required.');
  }
  next();
}

function validateDate(date: string) {
  if (!isValidDate(date)) {
    throw new AppError(400, 'INVALID_DATE', 'Please choose a valid date.');
  }
  if (date > todayInAthens()) {
    throw new AppError(400, 'FUTURE_DATE', 'Future dates are not allowed.');
  }
}

async function ensureSite(siteId: string, mustBeActive: boolean) {
  if (!validId(siteId)) {
    throw new AppError(400, 'INVALID_SITE', 'Please choose a valid work site.');
  }

  const site = await Site.findById(siteId).select('active');
  if (!site || (mustBeActive && !site.active)) {
    throw new AppError(400, 'SITE_UNAVAILABLE', 'The selected work site is not available.');
  }
}

async function bootstrapOrLoginAdmin(email: string, password: string) {
  const hasAdmin = await Admin.exists({});

  if (!hasAdmin) {
    const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const configuredPassword = process.env.ADMIN_PASSWORD || '';
    if (!configuredEmail || !configuredPassword) {
      throw new AppError(500, 'ADMIN_NOT_CONFIGURED', 'Admin login is not configured.');
    }
    if (email !== configuredEmail || password !== configuredPassword) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    try {
      return await Admin.create({
        email: configuredEmail,
        passwordHash: await bcrypt.hash(configuredPassword, 12),
        active: true
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  const account = await Admin.findOne({ email, active: true }).select('+passwordHash');
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  return account;
}

async function findWorkerByPin(pin: string) {
  const worker = await Worker.findOne({ pinKey: workerPinKey(pin), active: true }).select('+pinHash');
  if (!worker) return null;
  return await bcrypt.compare(pin, worker.pinHash) ? worker : null;
}

async function listEntries(query: Record<string, unknown>, limit: number) {
  const rows = await Entry.find(query)
    .sort({ date: -1, createdAt: -1 })
    .limit(limit)
    .populate({ path: 'workerId', select: 'name active' })
    .populate({ path: 'site', select: 'name' })
    .lean();

  return rows.map((row: any) => ({
    _id: String(row._id),
    workerId: String(row.workerId?._id || row.workerId || ''),
    workerName: row.workerId?.name || 'Unknown worker',
    workerActive: row.workerId?.active ?? false,
    date: row.date,
    site: String(row.site?._id || row.site || ''),
    siteName: row.site?.name || 'Unknown site',
    start: row.start ?? null,
    end: row.end ?? null,
    regular: row.regular,
    overtime: row.overtime
  }));
}

app.get('/api/health', async (_req, res) => {
  try {
    await connectDatabase();
    return res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error(error);
    return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database connection failed.');
  }
});

app.post('/api/auth/login', async (req, res) => {
  await connectDatabase();
  const body = req.body || {};

  if (body.role === 'admin') {
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    if (!email || !password) {
      return fail(res, 400, 'LOGIN_FIELDS_REQUIRED', 'Email and password are required.');
    }

    const account = await bootstrapOrLoginAdmin(email, password);
    return res.json({
      role: 'admin',
      token: jwt.sign({ role: 'admin', id: String(account._id) }, jwtSecret(), { expiresIn: '12h' })
    });
  }

  if (body.role !== 'worker') {
    return fail(res, 400, 'INVALID_ROLE', 'Please choose a valid login type.');
  }

  const pin = String(body.pin ?? '');
  if (!pin) return fail(res, 400, 'LOGIN_FIELDS_REQUIRED', 'PIN is required.');
  if (!/^\d{4,12}$/.test(pin)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect PIN.');

  const worker = await findWorkerByPin(pin);
  if (!worker) return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect PIN.');

  return res.json({
    role: 'worker',
    token: jwt.sign({ role: 'worker', id: String(worker._id) }, jwtSecret(), { expiresIn: '30d' })
  });
});

app.get('/api/sites', authenticate, async (_req, res) => {
  return res.json(
    await Site.find({ active: true }).select('name active').sort({ name: 1 }).lean()
  );
});

app.get('/api/entries', authenticate, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const query = user.role === 'worker' ? { workerId: user.id } : {};
  const limit = user.role === 'worker' ? 30 : 5000;
  return res.json(await listEntries(query, limit));
});

app.post('/api/entries', authenticate, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (user.role !== 'worker') {
    return fail(res, 403, 'WORKER_ONLY', 'Worker access is required.');
  }

  const date = text(req.body?.date);
  const site = text(req.body?.site);
  validateDate(date);
  await ensureSite(site, true);

  const existing = await Entry.findOne({ workerId: user.id, date }).select('_id').lean();
  if (existing) {
    return fail(res, 409, 'ENTRY_EXISTS', 'You already submitted an entry for this date. Ask the administrator to correct it if needed.');
  }

  const calculated = hoursFor(date, text(req.body?.start) || null, text(req.body?.end) || null);
  const entry = await Entry.create({ workerId: user.id, date, site, ...calculated });
  return res.status(201).json({ _id: entry._id });
});

app.get('/api/admin/workers', authenticate, requireAdmin, async (_req, res) => {
  return res.json(
    await Worker.find().select('name active').sort({ active: -1, name: 1 }).lean()
  );
});

app.post('/api/admin/workers', authenticate, requireAdmin, async (req, res) => {
  const name = text(req.body?.name);
  const pin = String(req.body?.pin ?? '');

  if (name.length < 2 || name.length > 80) {
    return fail(res, 400, 'INVALID_WORKER_NAME', 'Worker name must be between 2 and 80 characters.');
  }
  if (!/^\d{4,12}$/.test(pin)) {
    return fail(res, 400, 'INVALID_PIN', 'PIN must contain 4–12 digits.');
  }

  const pinKey = workerPinKey(pin);
  if (await Worker.exists({ pinKey })) {
    return fail(res, 409, 'PIN_EXISTS', 'This PIN is already assigned to another worker.');
  }

  const worker = await Worker.create({
    name,
    pinHash: await bcrypt.hash(pin, 12),
    pinKey,
    active: true
  });

  return res.status(201).json({ _id: worker._id, name: worker.name, active: worker.active });
});

app.patch('/api/admin/workers/:id', authenticate, requireAdmin, async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'INVALID_WORKER', 'Worker was not found.');

  const worker = await Worker.findById(req.params.id).select('+pinHash +pinKey');
  if (!worker) return fail(res, 404, 'WORKER_NOT_FOUND', 'Worker was not found.');

  if (req.body?.name !== undefined) {
    const name = text(req.body.name);
    if (name.length < 2 || name.length > 80) {
      return fail(res, 400, 'INVALID_WORKER_NAME', 'Worker name must be between 2 and 80 characters.');
    }
    worker.name = name;
  }

  if (req.body?.pin !== undefined && req.body.pin !== '') {
    const pin = String(req.body.pin);
    if (!/^\d{4,12}$/.test(pin)) {
      return fail(res, 400, 'INVALID_PIN', 'PIN must contain 4–12 digits.');
    }

    const pinKey = workerPinKey(pin);
    if (await Worker.exists({ pinKey, _id: { $ne: worker._id } })) {
      return fail(res, 409, 'PIN_EXISTS', 'This PIN is already assigned to another worker.');
    }

    worker.pinHash = await bcrypt.hash(pin, 12);
    worker.pinKey = pinKey;
  }

  if (typeof req.body?.active === 'boolean') worker.active = req.body.active;
  await worker.save();
  return res.json({ _id: worker._id, name: worker.name, active: worker.active });
});

app.get('/api/admin/sites', authenticate, requireAdmin, async (_req, res) => {
  return res.json(
    await Site.find().select('name active').sort({ active: -1, name: 1 }).lean()
  );
});

app.post('/api/admin/sites', authenticate, requireAdmin, async (req, res) => {
  const name = normalizeSiteName(req.body?.name);
  if (name.length < 2 || name.length > 80) {
    return fail(res, 400, 'INVALID_SITE_NAME', 'Site name must be between 2 and 80 characters.');
  }

  const nameKey = siteNameKey(name);
  if (await Site.exists({ nameKey })) {
    return fail(res, 409, 'SITE_EXISTS', 'This site already exists.');
  }

  const site = await Site.create({ name, nameKey, active: true });
  return res.status(201).json({ _id: site._id, name: site.name, active: site.active });
});

app.patch('/api/admin/sites/:id', authenticate, requireAdmin, async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'INVALID_SITE', 'Site was not found.');

  const site = await Site.findById(req.params.id).select('+nameKey');
  if (!site) return fail(res, 404, 'SITE_NOT_FOUND', 'Site was not found.');

  if (req.body?.name !== undefined) {
    const name = normalizeSiteName(req.body.name);
    if (name.length < 2 || name.length > 80) {
      return fail(res, 400, 'INVALID_SITE_NAME', 'Site name must be between 2 and 80 characters.');
    }

    const nameKey = siteNameKey(name);
    if (await Site.exists({ nameKey, _id: { $ne: site._id } })) {
      return fail(res, 409, 'SITE_EXISTS', 'This site already exists.');
    }
    site.name = name;
    site.nameKey = nameKey;
  }

  if (typeof req.body?.active === 'boolean') site.active = req.body.active;
  await site.save();
  return res.json({ _id: site._id, name: site.name, active: site.active });
});

app.patch('/api/admin/entries/:id', authenticate, requireAdmin, async (req, res) => {
  if (!validId(req.params.id)) {
    return fail(res, 400, 'INVALID_ENTRY', 'Timesheet entry was not found.');
  }

  const entry = await Entry.findById(req.params.id);
  if (!entry) return fail(res, 404, 'ENTRY_NOT_FOUND', 'Timesheet entry was not found.');

  const date = req.body?.date === undefined ? entry.date : text(req.body.date);
  const site = req.body?.site === undefined ? String(entry.site) : text(req.body.site);
  validateDate(date);
  await ensureSite(site, false);

  if (await Entry.exists({ workerId: entry.workerId, date, _id: { $ne: entry._id } })) {
    return fail(res, 409, 'ENTRY_EXISTS', 'This worker already has an entry for that date.');
  }

  const start = req.body?.start === undefined ? entry.start : text(req.body.start) || null;
  const end = req.body?.end === undefined ? entry.end : text(req.body.end) || null;
  const calculated = hoursFor(date, start, end);

  entry.date = date;
  entry.site = new mongoose.Types.ObjectId(site);
  entry.start = calculated.start;
  entry.end = calculated.end;
  entry.regular = calculated.regular;
  entry.overtime = calculated.overtime;
  await entry.save();

  const [updated] = await listEntries({ _id: entry._id }, 1);
  return res.json(updated);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    return fail(res, error.status, error.code, error.message);
  }

  const mongoError = error as {
    code?: number;
    keyPattern?: Record<string, number>;
  };

  if (mongoError?.code === 11000) {
    if (mongoError.keyPattern?.pinKey) {
      return fail(res, 409, 'PIN_EXISTS', 'This PIN is already assigned to another worker.');
    }
    if (mongoError.keyPattern?.nameKey) {
      return fail(res, 409, 'SITE_EXISTS', 'This site already exists.');
    }
    if (mongoError.keyPattern?.workerId && mongoError.keyPattern?.date) {
      return fail(res, 409, 'ENTRY_EXISTS', 'An entry already exists for this worker and date.');
    }
    return fail(res, 409, 'DUPLICATE_VALUE', 'This value is already in use.');
  }

  console.error(error);
  return fail(res, 500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
});

export default app;
