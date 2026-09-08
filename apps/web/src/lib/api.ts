const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const accessToken = typeof window === 'undefined' ? null : sessionStorage.getItem('sentinel.accessToken');
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init.headers },
  });
  if (response.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/refresh')) {
    const refreshToken = sessionStorage.getItem('sentinel.refreshToken');
    if (refreshToken) {
      const refreshResponse = await fetch(`${apiBaseUrl}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (refreshResponse.ok) {
        const refreshed = await refreshResponse.json() as { accessToken: string; refreshToken: string };
        sessionStorage.setItem('sentinel.accessToken', refreshed.accessToken);
        sessionStorage.setItem('sentinel.refreshToken', refreshed.refreshToken);
        return apiRequest<T>(path, init);
      }
    }
  }
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'Request failed');
  return response.json() as Promise<T>;
}

export async function login(email: string, password: string) {
  const result = await apiRequest<{ accessToken: string; refreshToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  sessionStorage.setItem('sentinel.accessToken', result.accessToken);
  sessionStorage.setItem('sentinel.refreshToken', result.refreshToken);
  return result;
}
