export type Lang = 'en' | 'el';
export type Role = 'worker' | 'admin';

export type Site = {
  _id: string;
  name: string;
  active: boolean;
};

export type Worker = {
  _id: string;
  name: string;
  active: boolean;
};

export type Entry = {
  _id: string;
  workerId: string;
  workerName: string;
  workerActive?: boolean;
  date: string;
  site: string;
  siteName: string;
  start?: string | null;
  end?: string | null;
  regular: number;
  overtime: number;
  submittedAt?: string | null;
  isLate: boolean;
  adminNote?: string;
};

export type AdminEntriesResponse = {
  items: Entry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
  totals: {
    regular: number;
    overtime: number;
  };
  lateCount: number;
  hoursByWorker: Array<{
    workerId: string;
    workerName: string;
    regular: number;
    overtime: number;
    total: number;
    entries: number;
  }>;
};

export type DashboardSummary = {
  activeWorkers: number;
  submittedToday: number;
  missingToday: number;
};
