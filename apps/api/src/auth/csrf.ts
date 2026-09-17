import { ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';

export const CSRF_COOKIE = 'sentinel.csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = [
  /^\/api\/health$/,
  /^\/api\/ready$/,
  /^\/api\/metrics$/,
  /^\/api\/docs/,
  /^\/api\/billing\/webhook$/,
];

function allowedWebOrigin() {
  return process.env.WEB_ORIGIN ?? 'http://localhost:3000';
}

export function csrfCookieOptions(): CookieOptions {
  const origin = allowedWebOrigin();
  const secure = origin.startsWith('https://');
  return {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
  };
}

export function issueCsrfToken(req: Request, res: Response) {
  const existing = req.cookies?.[CSRF_COOKIE];
  const token = typeof existing === 'string' && existing.length >= 16 ? existing : randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.some((pattern) => pattern.test(req.path))) {
    next();
    return;
  }

  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin === 'string' && requestOrigin === allowedWebOrigin()) {
    next();
    return;
  }

  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  if (!cookie || !token || cookie !== token) {
    next(new ForbiddenException('CSRF token is missing or invalid'));
    return;
  }
  next();
}
