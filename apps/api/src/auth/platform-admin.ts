const DEFAULT_ADMIN_EMAILS = 'admin@sentinel.dev';

export function isPlatformAdmin(email: string) {
  const allowed = (process.env.ADMIN_EMAILS?.trim() || DEFAULT_ADMIN_EMAILS)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
