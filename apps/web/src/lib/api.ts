const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const ACCESS_KEY = 'sentinel.accessToken';
const REFRESH_KEY = 'sentinel.refreshToken';
const USER_KEY = 'sentinel.user';
const WORKSPACE_KEY = 'sentinel.workspaceId';
const WORKSPACE_NAME_KEY = 'sentinel.workspaceName';

const PUBLIC_AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
const CSRF_KEY = 'sentinel.csrfToken';

export type AuthUser = { id: string; email: string };
export type TokenPair = { accessToken: string; refreshToken: string };
export type Workspace = { id: string; name: string; members?: Array<{ role: string }> };

function isBrowser() {
  return typeof window !== 'undefined';
}

function parseError(body: unknown) {
  if (!body || typeof body !== 'object') return 'Request failed';
  const message = (body as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.filter(Boolean).join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  return 'Request failed';
}

export function getAccessToken() {
  return isBrowser() ? sessionStorage.getItem(ACCESS_KEY) : null;
}

export function getRefreshToken() {
  return isBrowser() ? sessionStorage.getItem(REFRESH_KEY) : null;
}

export function getStoredUser(): AuthUser | null {
  if (!isBrowser()) return null;
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function getWorkspaceId() {
  return isBrowser() ? sessionStorage.getItem(WORKSPACE_KEY) : null;
}

export function getWorkspaceName() {
  return isBrowser() ? sessionStorage.getItem(WORKSPACE_NAME_KEY) : null;
}

export function setSession(tokens: TokenPair, user?: AuthUser) {
  sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
  sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setWorkspace(workspace: Pick<Workspace, 'id' | 'name'>) {
  sessionStorage.setItem(WORKSPACE_KEY, workspace.id);
  sessionStorage.setItem(WORKSPACE_NAME_KEY, workspace.name);
}

export function clearSession() {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(WORKSPACE_KEY);
  sessionStorage.removeItem(WORKSPACE_NAME_KEY);
}

export async function ensureCsrfToken(force = false) {
  if (!isBrowser()) return null;
  const cached = sessionStorage.getItem(CSRF_KEY);
  if (cached && !force) return cached;
  const response = await fetch(`${apiBaseUrl}/auth/csrf`, { credentials: 'include' });
  if (!response.ok) return null;
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) return null;
  sessionStorage.setItem(CSRF_KEY, body.csrfToken);
  return body.csrfToken;
}

function isPublicAuthRoute(pathname = window.location.pathname) {
  return PUBLIC_AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function redirectToLogin() {
  if (!isBrowser() || isPublicAuthRoute()) return;
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/login?next=${next}`);
}

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshSession() {
  if (!isBrowser()) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      clearSession();
      return false;
    }
    const tokens = (await response.json()) as TokenPair;
    setSession(tokens, getStoredUser() ?? undefined);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function shouldAttemptRefresh(path: string) {
  return !path.startsWith('/auth/login')
    && !path.startsWith('/auth/register')
    && !path.startsWith('/auth/refresh')
    && !path.startsWith('/auth/forgot-password')
    && !path.startsWith('/auth/reset-password')
    && !path.startsWith('/auth/verify-email');
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const accessToken = getAccessToken();
  if (accessToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`);
  const workspaceId = getWorkspaceId();
  if (workspaceId && !headers.has('x-workspace-id')) headers.set('x-workspace-id', workspaceId);

  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !headers.has('x-csrf-token')) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: 'include' });

  if (response.status === 403 && isBrowser() && !retried && method !== 'GET') {
    await ensureCsrfToken(true);
    return apiRequest<T>(path, init, true);
  }

  if (response.status === 401 && isBrowser() && shouldAttemptRefresh(path) && !retried) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, init, true);
    clearSession();
    if (!path.startsWith('/auth/')) redirectToLogin();
  }

  if (!response.ok) {
    throw new Error(parseError(await response.json().catch(() => null)));
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function login(email: string, password: string) {
  const result = await apiRequest<TokenPair & { user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(result, result.user);
  return result;
}

export async function register(email: string, password: string) {
  const result = await apiRequest<TokenPair & { user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(result, result.user);
  return result;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
  }
  clearSession();
}

export async function forgotPassword(email: string) {
  return apiRequest<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string) {
  return apiRequest<{ success: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export async function verifyEmail(token: string) {
  return apiRequest<{ success: boolean }>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function fetchCurrentUser() {
  const user = await apiRequest<AuthUser>('/auth/me');
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function safeNextPath(next: string | null) {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export type AssetType = 'DOMAIN' | 'SUBDOMAIN' | 'IP';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'EXPIRED';
export type ScanMode = 'SAFE' | 'NORMAL' | 'AGGRESSIVE';
export type ScanStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
export type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type Asset = {
  id: string;
  type: AssetType;
  value: string;
  verificationStatus: VerificationStatus;
  verificationToken: string | null;
  securityScore: number | null;
  lastScanAt: string | null;
  createdAt: string;
};

export type Scan = {
  id: string;
  assetId: string;
  mode: ScanMode;
  status: ScanStatus;
  stage: string;
  progress: number;
  score: number | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type Finding = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  status: FindingStatus;
  category: string;
  evidence: string;
  recommendation: string;
  lastDetectedAt: string;
  asset: { id: string; value: string };
};

export type Overview = {
  score: number | null;
  scoreDelta: number | null;
  assets: { total: number; verified: number; addedRecently: number };
  findings: { open: number; actionable: number; urgent: number; bySeverity: Record<Severity, number> };
  activeScans: number;
  recentFindings: Finding[];
  trend: Array<{ score: number; at: string }>;
  lastCompletedScan: { id: string; completedAt: string | null; score: number | null; asset: { value: string } } | null;
};

export type ScanDiff = {
  previousScore: number | null;
  currentScore: number | null;
  newFindings: Finding[];
  resolvedFindings: Finding[];
  changedFindings: Finding[];
  persistentFindings: Finding[];
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

export type ReportSummary = { id: string; scanId: string; format: 'JSON' | 'CSV'; createdAt: string };
export type Report = ReportSummary & { content: unknown };
export type Schedule = {
  id: string;
  assetId: string;
  mode: ScanMode;
  frequency: ScheduleFrequency;
  enabled: boolean;
  nextRunAt: string;
  asset: { id: string; value: string; type: AssetType };
};

export const fetchOverview = (workspaceId: string) => apiRequest<Overview>(`/workspaces/${workspaceId}/overview`);

export const listAssets = () => apiRequest<Asset[]>('/assets');
export const createAsset = (type: AssetType, value: string) =>
  apiRequest<Asset>('/assets', { method: 'POST', body: JSON.stringify({ type, value }) });
export const verifyAsset = (assetId: string) =>
  apiRequest<{ id: string; verificationStatus: VerificationStatus; value: string }>(`/assets/${assetId}/verify`, { method: 'POST' });

export const listScans = () => apiRequest<Scan[]>('/scans');
export const getScan = (scanId: string) => apiRequest<Scan & { asset: Asset; findings: Finding[] }>(`/scans/${scanId}`);
export const startScan = (assetId: string, mode: ScanMode) =>
  apiRequest<{ scanId: string; status: ScanStatus }>('/scans', { method: 'POST', body: JSON.stringify({ assetId, mode }) });
export const cancelScan = (scanId: string) => apiRequest<Scan>(`/scans/${scanId}/cancel`, { method: 'POST' });
export const diffScans = (previous: string, current: string) =>
  apiRequest<ScanDiff>(`/scans/diff?previous=${encodeURIComponent(previous)}&current=${encodeURIComponent(current)}`);

export const listFindings = (filters: { search?: string; severity?: string; status?: string } = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
  const suffix = query.toString();
  return apiRequest<Finding[]>(`/findings${suffix ? `?${suffix}` : ''}`);
};
export const updateFindingStatus = (findingId: string, status: FindingStatus) =>
  apiRequest<Finding>(`/findings/${findingId}`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const listReports = () => apiRequest<ReportSummary[]>('/reports');
export const createReport = (scanId: string, format: 'JSON' | 'CSV') =>
  apiRequest<ReportSummary>('/reports', { method: 'POST', body: JSON.stringify({ scanId, format }) });

export const listSchedules = () => apiRequest<Schedule[]>('/schedules');
export const createSchedule = (assetId: string, mode: ScanMode, frequency: ScheduleFrequency) =>
  apiRequest<Schedule>('/schedules', { method: 'POST', body: JSON.stringify({ assetId, mode, frequency }) });
export const pauseSchedule = (id: string) => apiRequest<Schedule>(`/schedules/${id}/pause`, { method: 'PATCH' });
export const resumeSchedule = (id: string) => apiRequest<Schedule>(`/schedules/${id}/resume`, { method: 'PATCH' });
export const deleteSchedule = (id: string) => apiRequest<{ success: boolean }>(`/schedules/${id}`, { method: 'DELETE' });

export const listNotifications = () => apiRequest<Notification[]>('/notifications');
export const markNotificationRead = (id: string) => apiRequest<Notification>(`/notifications/${id}/read`, { method: 'PATCH' });

/**
 * Reports are fetched through the authenticated client and turned into a blob
 * locally. A plain anchor to the API would omit the bearer token and workspace
 * header, so the download would fail with a 401.
 */
export async function downloadReport(summary: ReportSummary) {
  const report = await apiRequest<Report>(`/reports/${summary.id}`);
  const isCsv = report.format === 'CSV';
  const body = isCsv ? String(report.content) : JSON.stringify(report.content, null, 2);
  const blob = new Blob([body], { type: isCsv ? 'text/csv;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `sentinel-report-${summary.scanId}.${isCsv ? 'csv' : 'json'}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function websocketBaseUrl() {
  return apiBaseUrl.replace(/\/api\/?$/, '');
}
