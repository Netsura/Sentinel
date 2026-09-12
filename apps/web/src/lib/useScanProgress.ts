'use client';

import { useEffect, useRef, useState } from 'react';
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
  const socketRef = useRef<Socket | null>(null);
  const subscribed = useRef<Set<string>>(new Set());
  const key = [...scanIds].sort().join(',');

  useEffect(() => {
    if (!key) return;

    if (!socketRef.current) {
      socketRef.current = io(`${websocketBaseUrl()}/scans`, { transports: ['websocket'], reconnectionAttempts: 5 });
      socketRef.current.on('scan.progress', (event: { scanId: string; stage: string; progress: number }) => {
        setProgress((current) => ({ ...current, [event.scanId]: { stage: event.stage, progress: event.progress } }));
      });
    }

    const socket = socketRef.current;
    const token = getAccessToken();
    if (!token) return;

    for (const scanId of key.split(',')) {
      if (subscribed.current.has(scanId)) continue;
      subscribed.current.add(scanId);
      socket.emit('scan.subscribe', { token, scanId });
    }
  }, [key]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      subscribed.current.clear();
    };
  }, []);

  return progress;
}
