'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken, websocketBaseUrl } from './api';

export type ScanProgress = { stage: string; progress: number };

/**
 * Subscribes to the API's authenticated scan namespace. The gateway validates
 * the access token per subscription and only joins rooms for scans inside a
 * workspace the user belongs to, so subscribing to an unknown id is rejected.
 */
export function useScanProgress(scanIds: string[]) {
  const [progress, setProgress] = useState<Record<string, ScanProgress>>({});
  const key = [...scanIds].sort().join(',');

  useEffect(() => {
    if (!key) return;

    let socket: Socket | null = null;
    let interval: ReturnType<typeof setInterval> | undefined;
    const subscribed = new Set<string>();

    const subscribeAll = () => {
      const token = getAccessToken();
      if (!token) return false;
      if (!socket) {
        socket = io(`${websocketBaseUrl()}/scans`, { transports: ['websocket'], reconnectionAttempts: 5 });
        socket.on('scan.progress', (event: { scanId: string; stage: string; progress: number }) => {
          setProgress((current) => ({ ...current, [event.scanId]: { stage: event.stage, progress: event.progress } }));
        });
      }
      for (const scanId of key.split(',')) {
        if (subscribed.has(scanId)) continue;
        subscribed.add(scanId);
        socket.emit('scan.subscribe', { token, scanId });
      }
      return true;
    };

    if (!subscribeAll()) {
      interval = setInterval(() => {
        if (subscribeAll() && interval) clearInterval(interval);
      }, 400);
    }

    return () => {
      if (interval) clearInterval(interval);
      socket?.disconnect();
    };
  }, [key]);

  return progress;
}
