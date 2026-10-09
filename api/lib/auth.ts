import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import { Admin, Worker, connectDatabase, validId } from './db';
import { text } from './errors';

export type Role = 'admin' | 'worker';
export type AuthClaims = JwtPayload & { role: Role; id: string };
export type AuthenticatedRequest = Request & { user: AuthClaims };

function fail(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
}

export function jwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 24) throw new Error('JWT_SECRET is not configured securely');
  return value;
}

export function workerPinKey(pin: string) {
  const secret = process.env.PIN_LOOKUP_SECRET || jwtSecret();
  if (secret.length < 24) throw new Error('PIN_LOOKUP_SECRET is not configured securely');
  return createHmac('sha256', secret).update(`worktime-worker-pin:${pin}`).digest('hex');
}

export async function loginAdmin(email: string, password: string) {
  const account = await Admin.findOne({ email, active: true }).select('+passwordHash');
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) return null;
  return account;
}

export async function findWorkerByPin(pin: string) {
  const worker = await Worker.findOne({ pinKey: workerPinKey(pin), active: true }).select('+pinHash');
  if (!worker) return null;
  return await bcrypt.compare(pin, worker.pinHash) ? worker : null;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = text(req.headers.authorization);
    if (!header.startsWith('Bearer ')) return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');

    const decoded = jwt.verify(header.slice(7), jwtSecret(), { algorithms: ['HS256'] });
    if (
      typeof decoded === 'string' ||
      (decoded.role !== 'admin' && decoded.role !== 'worker') ||
      typeof decoded.id !== 'string' ||
      !validId(decoded.id)
    ) {
      return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
    }

    await connectDatabase();
    const activeAccount = decoded.role === 'admin'
      ? await Admin.exists({ _id: decoded.id, active: true })
      : await Worker.exists({ _id: decoded.id, active: true });

    if (!activeAccount) return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');

    (req as AuthenticatedRequest).user = decoded as AuthClaims;
    return next();
  } catch {
    return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in again.');
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthenticatedRequest).user.role !== 'admin') {
    return fail(res, 403, 'ADMIN_ONLY', 'Administrator access is required.');
  }
  return next();
}
