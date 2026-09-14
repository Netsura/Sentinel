'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  apiRequest,
  clearSession,
  ensureCsrfToken,
  fetchCurrentUser,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  getWorkspaceId,
  logout as logoutRequest,
  refreshSession,
  setWorkspace as persistWorkspace,
  type AuthUser,
  type Workspace,
} from '../lib/api';

type AuthContextValue = {
  user: AuthUser;
  workspaces: Workspace[];
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthGate');
  return value;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);

  const boot = useCallback(async () => {
    await ensureCsrfToken();
    if (!getAccessToken()) {
      const restored = getRefreshToken() ? await refreshSession() : false;
      if (!restored) {
        const next = encodeURIComponent(pathname || '/');
        router.replace(`/login?next=${next}`);
        return;
      }
    }

    try {
      const currentUser = await fetchCurrentUser();
      setUser(currentUser);
      let list = await apiRequest<Workspace[]>('/workspaces');
      if (list.length === 0) {
        const created = await apiRequest<Workspace>('/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name: 'Personal workspace' }),
        });
        list = [created];
      }
      const savedId = getWorkspaceId();
      const current = list.find((item) => item.id === savedId) ?? list[0];
      persistWorkspace(current);
      setWorkspaces(list);
      setWorkspaceState(current);
      setReady(true);
    } catch {
      clearSession();
      router.replace('/login');
    }
  }, [pathname, router]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const setWorkspace = useCallback((next: Workspace) => {
    persistWorkspace(next);
    setWorkspaceState(next);
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    router.replace('/login');
  }, [router]);

  const value = useMemo(() => {
    if (!user || !workspace) return null;
    return { user, workspaces, workspace, setWorkspace, logout };
  }, [logout, setWorkspace, user, workspace, workspaces]);

  if (!ready || !value) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f4f6f2', color: '#778381', fontFamily: 'Manrope, sans-serif' }}>
        <p>Loading Sentinel…</p>
      </main>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
