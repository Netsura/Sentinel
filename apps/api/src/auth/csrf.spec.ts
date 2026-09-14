import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CSRF_COOKIE, CSRF_HEADER, csrfProtection, issueCsrfToken } from './csrf';

function mockRes() {
  const cookies: Record<string, string> = {};
  return {
    cookies,
    cookie: (name: string, value: string) => {
      cookies[name] = value;
    },
  } as unknown as Response & { cookies: Record<string, string> };
}

describe('csrfProtection', () => {
  it('allows safe methods and exempt webhook paths', () => {
    const next = jest.fn();
    csrfProtection({ method: 'GET', path: '/api/auth/csrf', cookies: {}, headers: {} } as Request, {} as Response, next);
    csrfProtection({ method: 'POST', path: '/api/billing/webhook', cookies: {}, headers: {} } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls.every(([error]) => error === undefined)).toBe(true);
  });

  it('rejects mutating requests without a matching header', () => {
    const next = jest.fn();
    csrfProtection({ method: 'POST', path: '/api/auth/login', cookies: { [CSRF_COOKIE]: 'abc' }, headers: {} } as unknown as Request, {} as Response, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenException);
  });

  it('accepts a matching double-submit token', () => {
    const next = jest.fn();
    csrfProtection({
      method: 'POST',
      path: '/api/auth/login',
      cookies: { [CSRF_COOKIE]: 'secret-token' },
      headers: { [CSRF_HEADER]: 'secret-token' },
    } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('reuses an existing cookie when issuing a token', () => {
    const req = { cookies: { [CSRF_COOKIE]: 'already-set-token-value' } } as unknown as Request;
    const res = mockRes();
    expect(issueCsrfToken(req, res)).toBe('already-set-token-value');
  });
});
