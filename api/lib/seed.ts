import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { Entry, Site, Worker } from './db.js';
import { workerPinKey } from './auth.js';
import { appDate, hoursFor, isLateSubmission } from './time.js';

const demoWorkerNames = [
  'Demo Worker 1',
  'Demo Worker 2',
  'Demo Worker 3',
  'Demo Worker 4'
];

const demoSiteNames = [
  'Demo Site - Athens',
  'Demo Site - Piraeus',
  'Demo Site - Marousi'
];

function previousDate(daysAgo: number) {
  const date = new Date(`${appDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function getOrCreateDemoWorker(name: string) {
  const existingWorker = await Worker.findOne({ name });
  if (existingWorker) return { worker: existingWorker, created: false };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = String(randomInt(100000, 1000000));
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

  throw new Error('Could not create a demo worker with a unique PIN.');
}

async function getOrCreateDemoSite(name: string) {
  const nameKey = name.toLowerCase();
  const existingSite = await Site.findOne({ nameKey });

  if (existingSite) {
    if (!existingSite.active) {
      existingSite.active = true;
      await existingSite.save();
    }
    return { site: existingSite, created: false };
  }

  const site = await Site.create({ name, nameKey, active: true });
  return { site, created: true };
}

export async function seedDemoData() {
  let workersCreated = 0;
  let sitesCreated = 0;
  let entriesCreated = 0;

  const workers = [];
  for (const name of demoWorkerNames) {
    const result = await getOrCreateDemoWorker(name);
    workers.push(result.worker);
    if (result.created) workersCreated += 1;
  }

  const sites = [];
  for (const name of demoSiteNames) {
    const result = await getOrCreateDemoSite(name);
    sites.push(result.site);
    if (result.created) sitesCreated += 1;
  }

  for (let day = 0; day < 21; day += 1) {
    const date = previousDate(day);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

    if (weekday === 0) continue;

    for (let workerIndex = 0; workerIndex < workers.length; workerIndex += 1) {
      const worker = workers[workerIndex];
      const site = sites[(day + workerIndex) % sites.length];

      const entryAlreadyExists = await Entry.exists({
        workerId: worker._id,
        date
      });
      if (entryAlreadyExists) continue;

      const isSaturday = weekday === 6;
      const start = workerIndex % 2 === 0 ? '08:00' : '07:30';
      const end = isSaturday
        ? (workerIndex % 2 === 0 ? '15:00' : '16:00')
        : (workerIndex % 2 === 0 ? '16:00' : '17:30');

      const calculatedHours = hoursFor(date, start, end);
      const submittedAt = new Date(`${date}T12:00:00Z`);

      if ((day + workerIndex) % 5 === 0) {
        submittedAt.setUTCDate(submittedAt.getUTCDate() + 1);
      }

      await Entry.create({
        workerId: worker._id,
        workerNameSnapshot: worker.name,
        date,
        site: site._id,
        siteNameSnapshot: site.name,
        ...calculatedHours,
        submittedAt,
        isLate: isLateSubmission(date, submittedAt),
        adminNote: ''
      });

      entriesCreated += 1;
    }
  }

  return {
    workersCreated,
    sitesCreated,
    entriesCreated
  };
}
