import { isPlatformAdmin } from './platform-admin';

describe('isPlatformAdmin', () => {
  const previous = process.env.ADMIN_EMAILS;

  afterEach(() => {
    process.env.ADMIN_EMAILS = previous;
  });

  it('matches configured admin emails case-insensitively', () => {
    process.env.ADMIN_EMAILS = 'admin@sentinel.dev, owner@example.com';
    expect(isPlatformAdmin('admin@sentinel.dev')).toBe(true);
    expect(isPlatformAdmin('Admin@Sentinel.dev')).toBe(true);
    expect(isPlatformAdmin('user@example.com')).toBe(false);
  });

  it('matches nobody when ADMIN_EMAILS is empty', () => {
    process.env.ADMIN_EMAILS = '';
    expect(isPlatformAdmin('admin@sentinel.dev')).toBe(false);
  });
});
