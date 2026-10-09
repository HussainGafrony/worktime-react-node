export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'SERVER_ERROR', status = 500) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function throwApiError(response: Response) {
  const body = await response.json().catch(() => ({}));
  throw new ApiError(body.error || 'Request failed.', body.code || 'SERVER_ERROR', response.status);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) await throwApiError(response);
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, fallbackFilename: string) {
  const response = await fetch(`/api${path}`, {
    headers: {
      ...authHeaders()
    }
  });

  if (!response.ok) await throwApiError(response);

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
