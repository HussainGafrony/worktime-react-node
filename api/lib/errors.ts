export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
