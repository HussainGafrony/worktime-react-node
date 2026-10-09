import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppError, text } from './lib/errors';
import { Admin, Entry, Site, Worker, connectDatabase, databaseName, objectId, validId } from './lib/db';
import { type AuthenticatedRequest, authenticate, createSession, findWorkerByPin, loginAdmin, requireAdmin, revokeSession, workerPinKey } from './lib/auth';
import { adminEntryPage, allEntries, buildEntryQuery, listEntries } from './lib/entries';
import { appDate, hoursFor, isLateSubmission, validateWorkDate } from './lib/time';
import { buildXlsx } from './lib/xlsx';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

function route(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function fail(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
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

async function ensureSite(siteId: string, mustBeActive: boolean) {
  if (!validId(siteId)) throw new AppError(400, 'INVALID_SITE', 'Please choose a valid work site.');
  const site = await Site.findById(siteId).select('active');
  if (!site || (mustBeActive && !site.active)) {
    throw new AppError(400, 'SITE_UNAVAILABLE', 'The selected work site is not available.');
  }
}

function pageNumber(value: unknown, fallback: number, max: number) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function safeFilenameDate() {
  return appDate().replace(/[^0-9-]/g, '');
}

function queryFilters(req: Request) {
  return buildEntryQuery({
    worker: req.query.worker,
    site: req.query.site,
    date: req.query.date,
    week: req.query.week,
    month: req.query.month,
    late: req.query.late
  });
}

app.get('/api/health', route(async (_req, res) => {
  await connectDatabase();
  return res.json({ ok: true, database: databaseName() });
}));

app.post('/api/auth/login', route(async (req, res) => {
  await connectDatabase();
  const body = req.body || {};

  if (body.role === 'admin') {
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    if (!email || !password) {
      return fail(res, 400, 'LOGIN_FIELDS_REQUIRED', 'Email and password are required.');
    }

    const account = await loginAdmin(email, password);
    if (!account) return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

    return res.json({
      role: 'admin',
      name: account.email,
      token: await createSession('admin', String(account._id))
    });
  }

  if (body.role !== 'worker') {
    return fail(res, 400, 'INVALID_ROLE', 'Please choose a valid login type.');
  }

  const pin = String(body.pin ?? '');
  if (!pin) return fail(res, 400, 'LOGIN_FIELDS_REQUIRED', 'PIN is required.');
  if (!/^\d{4,12}$/.test(pin)) {
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect PIN.');
  }

  const worker = await findWorkerByPin(pin);
  if (!worker) return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect PIN.');

  return res.json({
    role: 'worker',
    name: worker.name,
    token: await createSession('worker', String(worker._id))
  });
}));

app.post('/api/auth/logout', authenticate, route(async (req, res) => {
  const header = text(req.headers.authorization);
  await revokeSession(header.startsWith('Bearer ') ? header.slice(7) : '');
  return res.json({ ok: true });
}));

app.get('/api/sites', authenticate, route(async (_req, res) => {
  return res.json(await Site.find({ active: true }).select('name active').sort({ name: 1 }).lean());
}));

app.get('/api/entries', authenticate, route(async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (user.role === 'worker') {
    return res.json(await listEntries({ workerId: objectId(user.id) }, 30));
  }

  // Backward-compatible admin response. The admin UI uses /api/admin/entries.
  return res.json(await listEntries({}, 100));
}));

app.post('/api/entries', authenticate, route(async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (user.role !== 'worker') {
    return fail(res, 403, 'WORKER_ONLY', 'Worker access is required.');
  }

  const date = text(req.body?.date);
  const site = text(req.body?.site);
  validateWorkDate(date);
  await ensureSite(site, true);

  const workerId = objectId(user.id);
  if (await Entry.exists({ workerId, date })) {
    return fail(
      res,
      409,
      'ENTRY_EXISTS',
      'You already submitted an entry for this date. Ask the administrator to add a note if needed.'
    );
  }

  const submittedAt = new Date();
  const calculated = hoursFor(
    date,
    text(req.body?.start) || null,
    text(req.body?.end) || null
  );

  const entry = await Entry.create({
    workerId,
    date,
    site: objectId(site),
    ...calculated,
    submittedAt,
    isLate: isLateSubmission(date, submittedAt),
    adminNote: ''
  });

  return res.status(201).json({ _id: String(entry._id) });
}));

app.get('/api/admin/dashboard', authenticate, requireAdmin, route(async (_req, res) => {
  const today = appDate();
  const activeWorkers = await Worker.find({ active: true }).select('_id').lean();
  const activeIds = activeWorkers.map((worker) => worker._id);
  const submittedIds = activeIds.length
    ? await Entry.distinct('workerId', { workerId: { $in: activeIds }, date: today })
    : [];

  return res.json({
    activeWorkers: activeIds.length,
    submittedToday: submittedIds.length,
    missingToday: Math.max(0, activeIds.length - submittedIds.length)
  });
}));

app.get('/api/admin/entries', authenticate, requireAdmin, route(async (req, res) => {
  const query = queryFilters(req);
  const page = pageNumber(req.query.page, 1, 100000);
  const pageSize = pageNumber(req.query.pageSize, 50, 200);
  return res.json(await adminEntryPage(query, page, pageSize));
}));

app.get('/api/admin/entries/export', authenticate, requireAdmin, route(async (req, res) => {
  const query = queryFilters(req);
  const format = text(req.query.format).toLowerCase();
  if (format !== 'csv' && format !== 'xlsx') {
    return fail(res, 400, 'INVALID_EXPORT_FORMAT', 'Export format must be csv or xlsx.');
  }

  const rows = await allEntries(query);
  const headers = [
    'Worker',
    'Date',
    'Work site',
    'Start',
    'Finish',
    'Regular',
    'Overtime',
    'Status',
    'Submitted at',
    'Accountant note'
  ];
  const filename = `worktime-${safeFilenameDate()}`;

  if (format === 'csv') {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvRows = rows.map((row) => [
      row.workerName,
      row.date,
      row.siteName,
      row.start || '',
      row.end || '',
      row.regular,
      row.overtime,
      row.isLate ? 'Late' : 'On time',
      row.submittedAt || '',
      row.adminNote || ''
    ]);
    const csv = '\uFEFF' + [headers, ...csvRows]
      .map((row) => row.map(escape).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv);
  }

  const xlsxRows = [
    headers,
    ...rows.map((row) => [
      row.workerName,
      row.date,
      row.siteName,
      row.start || '',
      row.end || '',
      row.regular,
      row.overtime,
      row.isLate ? 'Late' : 'On time',
      row.submittedAt || '',
      row.adminNote || ''
    ])
  ];
  const buffer = buildXlsx(xlsxRows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  return res.send(buffer);
}));

app.get('/api/admin/workers', authenticate, requireAdmin, route(async (_req, res) => {
  return res.json(await Worker.find().select('name active').sort({ active: -1, name: 1 }).lean());
}));

app.post('/api/admin/workers', authenticate, requireAdmin, route(async (req, res) => {
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

  return res.status(201).json({
    _id: String(worker._id),
    name: worker.name,
    active: worker.active
  });
}));

app.patch('/api/admin/workers/:id', authenticate, requireAdmin, route(async (req, res) => {
  if (!validId(req.params.id)) {
    return fail(res, 400, 'INVALID_WORKER', 'Worker was not found.');
  }

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
  return res.json({ _id: String(worker._id), name: worker.name, active: worker.active });
}));

app.get('/api/admin/sites', authenticate, requireAdmin, route(async (_req, res) => {
  return res.json(await Site.find().select('name active').sort({ active: -1, name: 1 }).lean());
}));

app.post('/api/admin/sites', authenticate, requireAdmin, route(async (req, res) => {
  const name = normalizeSiteName(req.body?.name);
  if (name.length < 2 || name.length > 80) {
    return fail(res, 400, 'INVALID_SITE_NAME', 'Site name must be between 2 and 80 characters.');
  }

  const nameKey = siteNameKey(name);
  if (await Site.exists({ nameKey })) {
    return fail(res, 409, 'SITE_EXISTS', 'This site already exists.');
  }

  return res.status(201).json(await Site.create({ name, nameKey, active: true }));
}));

app.patch('/api/admin/sites/:id', authenticate, requireAdmin, route(async (req, res) => {
  if (!validId(req.params.id)) {
    return fail(res, 400, 'INVALID_SITE', 'Site was not found.');
  }

  const site = await Site.findById(req.params.id);
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
  return res.json({ _id: String(site._id), name: site.name, active: site.active });
}));

app.patch('/api/admin/entries/:id', authenticate, requireAdmin, route(async (req, res) => {
  if (!validId(req.params.id)) {
    return fail(res, 400, 'INVALID_ENTRY', 'Timesheet entry was not found.');
  }

  const allowedKeys = new Set(['adminNote']);
  const suppliedKeys = Object.keys(req.body || {});
  if (suppliedKeys.some((key) => !allowedKeys.has(key))) {
    return fail(res, 400, 'NOTE_ONLY', 'Only the accountant note can be edited.');
  }

  const entry = await Entry.findById(req.params.id);
  if (!entry) return fail(res, 404, 'ENTRY_NOT_FOUND', 'Timesheet entry was not found.');

  entry.adminNote = text(req.body?.adminNote).slice(0, 500);
  await entry.save();

  return res.json({ ok: true, adminNote: entry.adminNote });
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    return fail(res, error.status, error.code, error.message);
  }

  const mongoError = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    name?: string;
  };

  if (mongoError.code === 11000) {
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
