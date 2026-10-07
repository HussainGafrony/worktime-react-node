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
  submittedAt?: string;
  isLate?: boolean;
};