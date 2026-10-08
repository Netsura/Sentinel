import { jwtAccessSecret } from './secrets';

describe('jwtAccessSecret', () => {
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  const previousEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.JWT_ACCESS_SECRET = previousSecret;
    process.env.NODE_ENV = previousEnv;
  });

  it('uses the configured secret when present', () => {
    process.env.JWT_ACCESS_SECRET = ' configured-secret ';
    expect(jwtAccessSecret()).toBe('configured-secret');
  });

  it('allows a development fallback outside production', () => {
    delete process.env.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = 'test';
    expect(jwtAccessSecret()).toBe('sentinel-development-access-secret');
  });

  it('fails closed in production when the secret is missing', () => {
    delete process.env.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => jwtAccessSecret()).toThrow('JWT_ACCESS_SECRET is required in production');
  });
});
