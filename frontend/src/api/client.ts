// API Client for Dawaee SaaS

export const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

export function getAuthToken(): string | null {
  return localStorage.getItem('dawaee_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('dawaee_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('dawaee_token');
  localStorage.removeItem('dawaee_user');
  localStorage.removeItem('dawaee_pharmacy');
  fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}

export function getStoredUser(): any | null {
  const user = localStorage.getItem('dawaee_user');
  return user ? JSON.parse(user) : null;
}

export function getStoredPharmacy(): any | null {
  const p = localStorage.getItem('dawaee_pharmacy');
  return p ? JSON.parse(p) : null;
}

export function getStoredBranches(): any[] {
  const b = localStorage.getItem('dawaee_branches');
  return b ? JSON.parse(b) : [];
}

export function setStoredBranches(branches: any[]) {
  localStorage.setItem('dawaee_branches', JSON.stringify(branches));
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg =
      data?.message ||
      (Array.isArray(data?.message) ? data.message.join(', ') : 'حدث خطأ في الاتصال بالسيرفر');
    throw new Error(errorMsg);
  }

  return data as T;
}
