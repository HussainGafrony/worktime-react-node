import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { Entry, Site, Worker } from './db.js';
import { workerPinKey } from './auth.js';
import { appDate, hoursFor, isLateSubmission } from './time.js';

const DEMO_WORKERS = [
  'Demo Worker 1',
  'Demo Worker 2',
  'Demo Worker 3',
  'Demo Worker 4'
];

const DEMO_SITES = [
  'Demo Site - Athens',
  'Demo Site - Piraeus',
  'Demo Site - Marousi'
];

function dateMinusDays(days: number) {
  const base = new Date(`${appDate()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

function submittedAtFor(date: string, late: boolean) {
  const value = new Date(`${date}T12:00:00Z`);
  if (late) value.setUTCDate(value.getUTCDate() + 1);
  return value;
}

async function createUniqueWorker(name: string) {
  const existing = await Worker.findOne({ name });
  if (existing) return { worker: existing, created: false };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = String(randomInt(100000, 999999));
    const pinKey = workerPinKey(pin);
    if (await Worker.exists({ pinKey })) continue;

    const worker = await Worker.create({
      name,
      pinHash: await bcrypt.hash(pin, 12),
      pinKey,
      active: true
    });

    return { worker, created: true };
  }

  throw new Error('Could not generate a unique demo worker PIN.');
}

export async function seedDemoData() {
  let workersCreated = 0;
  let sitesCreated = 0;
  let entriesCreated = 0;

  const workers = [];
  for (const name of DEMO_WORKERS) {
    const result = await createUniqueWorker(name);
    if (result.created) workersCreated += 1;
    workers.push(result.worker);
  }

  const sites = [];
  for (const name of DEMO_SITES) {
    const nameKey = name.toLowerCase();
    let site = await Site.findOne({ nameKey });
    if (!site) {
      site = await Site.create({ name, nameKey, active: true });
      sitesCreated += 1;
    } else if (!site.active) {
      site.active = true;
      await site.save();
    }
    sites.push(site);
  }

  for (let dayOffset = 0; dayOffset < 21; dayOffset += 1) {
    const date = dateMinusDays(dayOffset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;

    for (let workerIndex = 0; workerIndex < workers.length; workerIndex += 1) {
      const worker = workers[workerIndex];
      const site = sites[(dayOffset + workerIndex) % sites.length];
      const saturday = weekday === 6;
      const start = workerIndex % 2 === 0 ? '08:00' : '07:30';
      const end = saturday
        ? (workerIndex % 2 === 0 ? '15:00' : '16:00')
        : (workerIndex % 2 === 0 ? '16:00' : '17:30');

      const calculated = hoursFor(date, start, end);
      const submittedAt = submittedAtFor(date, (dayOffset + workerIndex) % 5 === 0);

      const result = await Entry.updateOne(
        { workerId: worker._id, date },
        {
          $setOnInsert: {
            workerId: worker._id,
            workerNameSnapshot: worker.name,
            date,
            site: site._id,
            siteNameSnapshot: site.name,
            ...calculated,
            submittedAt,
            isLate: isLateSubmission(date, submittedAt),
            adminNote: ''
          }
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) entriesCreated += 1;
    }
  }

  return {
    workersCreated,
    sitesCreated,
    entriesCreated
  };
}
