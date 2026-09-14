import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

type RequestStore = { ipAddress?: string };

const storage = new AsyncLocalStorage<RequestStore>();

export function getRequestIp() {
  return storage.getStore()?.ipAddress;
}

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  storage.run({ ipAddress: first?.trim() || req.ip || req.socket.remoteAddress }, next);
}
