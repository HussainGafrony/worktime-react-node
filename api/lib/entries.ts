import mongoose from 'mongoose';
import { Entry, objectId, validId } from './db';
import { isLateSubmission, isoWeekRange, monthRange } from './time';
import { AppError, text } from './errors';

export type EntryQueryInput = {
  worker?: unknown;
  site?: unknown;
  date?: unknown;
  week?: unknown;
  month?: unknown;
  late?: unknown;
};

export function buildEntryQuery(input: EntryQueryInput) {
  const query: Record<string, unknown> = {};

  const worker = text(input.worker);
  if (worker) {
    if (!validId(worker)) throw new AppError(400, 'INVALID_WORKER', 'Worker was not found.');
    query.workerId = objectId(worker);
  }

  const site = text(input.site);
  if (site) {
    if (!validId(site)) throw new AppError(400, 'INVALID_SITE', 'Site was not found.');
    query.site = objectId(site);
  }

  const exactDate = text(input.date);
  const week = text(input.week);
  const month = text(input.month);

  if (exactDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exactDate)) throw new AppError(400, 'INVALID_DATE', 'Please choose a valid date.');
    query.date = exactDate;
  } else if (week) {
    const range = isoWeekRange(week);
    if (!range) throw new AppError(400, 'INVALID_DATE', 'Please choose a valid week.');
    query.date = { $gte: range.from, $lte: range.to };
  } else if (month) {
    const range = monthRange(month);
    if (!range) throw new AppError(400, 'INVALID_DATE', 'Please choose a valid month.');
    query.date = { $gte: range.from, $lte: range.to };
  }

  if (input.late === true || input.late === 'true' || input.late === '1') query.isLate = true;

  return query;
}

export function entryToJson(row: any) {
  const submittedAt = row.submittedAt || row.createdAt || null;
  const isLate = typeof row.isLate === 'boolean'
    ? row.isLate
    : Boolean(submittedAt && isLateSubmission(row.date, new Date(submittedAt)));

  return {
    _id: String(row._id),
    workerId: String(row.workerId?._id || row.workerId || ''),
    workerName: row.workerNameSnapshot || row.workerId?.name || 'Unknown worker',
    workerActive: row.workerId?.active ?? false,
    date: row.date,
    site: String(row.site?._id || row.site || ''),
    siteName: row.siteNameSnapshot || row.site?.name || 'Unknown site',
    start: row.start ?? null,
    end: row.end ?? null,
    regular: row.regular,
    overtime: row.overtime,
    submittedAt: submittedAt ? new Date(submittedAt).toISOString() : null,
    isLate,
    adminNote: row.adminNote || ''
  };
}

export async function listEntries(query: Record<string, unknown>, limit: number, skip = 0) {
  const rows = await Entry.find(query)
    .sort({ date: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({ path: 'workerId', select: 'name active' })
    .populate({ path: 'site', select: 'name' })
    .lean();

  return rows.map(entryToJson);
}

export async function adminEntryPage(query: Record<string, unknown>, page: number, pageSize: number) {
  const skip = (page - 1) * pageSize;

  const [items, total, summaryRows, hoursRows] = await Promise.all([
    listEntries(query, pageSize, skip),
    Entry.countDocuments(query),
    Entry.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          regular: { $sum: '$regular' },
          overtime: { $sum: '$overtime' },
          lateCount: { $sum: { $cond: ['$isLate', 1, 0] } }
        }
      }
    ]),
    Entry.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$workerId',
          regular: { $sum: '$regular' },
          overtime: { $sum: '$overtime' },
          entries: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'workers',
          localField: '_id',
          foreignField: '_id',
          as: 'worker'
        }
      },
      { $unwind: { path: '$worker', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          workerId: { $toString: '$_id' },
          workerName: { $ifNull: ['$worker.name', 'Unknown worker'] },
          regular: 1,
          overtime: 1,
          total: { $add: ['$regular', '$overtime'] },
          entries: 1
        }
      },
      { $sort: { workerName: 1 } }
    ])
  ]);

  const summary = summaryRows[0] || { regular: 0, overtime: 0, lateCount: 0 };

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize))
    },
    totals: {
      regular: Number(summary.regular || 0),
      overtime: Number(summary.overtime || 0)
    },
    lateCount: Number(summary.lateCount || 0),
    hoursByWorker: hoursRows
  };
}

export async function allEntries(query: Record<string, unknown>, maxRows = 50000) {
  const count = await Entry.countDocuments(query);
  if (count > maxRows) {
    throw new AppError(413, 'EXPORT_TOO_LARGE', `Export is limited to ${maxRows} rows. Narrow the filters first.`);
  }
  return listEntries(query, maxRows, 0);
}

export function mongoId(value: string) {
  return new mongoose.Types.ObjectId(value);
}
