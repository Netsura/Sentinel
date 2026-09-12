'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { listNotifications, markNotificationRead, type Notification } from '../lib/api';
import { initials, relativeTime } from '../lib/format';
import { useAuth } from './AuthContext';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/assets', label: 'Assets' },
  { href: '/scans', label: 'Scans' },
  { href: '/findings', label: 'Findings' },
  { href: '/reports', label: 'Reports' },
  { href: '/schedules', label: 'Schedules' },
] as const;

type NotificationContextValue = {
  notifications: Notification[];
  unreadCount: number;
  open: boolean;
  toggle: () => void;
  read: (notification: Notification) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, workspace, workspaces, setWorkspace, logout } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);

  useEffect(() => {
    const load = () => {
      listNotifications()
        .then(setNotifications)
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [workspace.id]);

  const read = useCallback((notification: Notification) => {
    if (notification.readAt) return;
    setNotifications((current) => current.map((item) => (item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)));
    void markNotificationRead(notification.id).catch(() => undefined);
  }, []);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, open, toggle, read }}>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link className={styles.brand} href="/">
            <span className={styles.brandMark}>S</span>
            <span>sentinel</span>
          </Link>

          <div className={styles.workspaceWrap}>
            <button className={styles.workspace} onClick={() => setShowWorkspaces((value) => !value)} aria-expanded={showWorkspaces}>
              <span className={styles.workspaceDot} />
              <span className={styles.workspaceName}>{workspace.name}</span>
              <span className={styles.chevron}>⌄</span>
            </button>
            {showWorkspaces && (
              <div className={styles.workspaceMenu}>
                {workspaces.map((item) => (
                  <button
                    className={styles.workspaceOption}
                    key={item.id}
                    aria-current={item.id === workspace.id}
                    onClick={() => {
                      setWorkspace(item);
                      setShowWorkspaces(false);
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <nav className={styles.navList} aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  className={`${styles.navItem} ${active ? styles.activeNav : ''}`}
                  href={item.href}
                  key={item.href}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className={styles.navIcon}>{item.label.slice(0, 1)}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={styles.sidebarBottom}>
            <div className={styles.profile}>
              <span className={styles.avatar}>{initials(user.email)}</span>
              <span className={styles.profileText}>
                <strong title={user.email}>{user.email}</strong>
                <small>{workspace.members?.[0]?.role ?? 'Member'}</small>
              </span>
              <button className={styles.signOut} onClick={() => void logout()}>
                Sign out
              </button>
            </div>
          </div>
        </aside>

        <section className={styles.content}>{children}</section>
      </div>
    </NotificationContext.Provider>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <div className={styles.headerActions}>
        {actions}
        <NotificationBell />
      </div>
    </header>
  );
}

function NotificationBell() {
  const value = useContext(NotificationContext);
  if (!value) return null;
  const { notifications, unreadCount, open, toggle, read } = value;

  return (
    <div className={styles.notifications}>
      <button
        className={styles.iconButton}
        onClick={toggle}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
      >
        N
        {unreadCount > 0 && <span className={styles.bellDot} />}
      </button>
      {open && (
        <div className={styles.notificationPanel}>
          {notifications.length === 0 ? (
            <p className={styles.notificationEmpty}>No notifications yet.</p>
          ) : (
            notifications.map((notification) => (
              <button
                className={`${styles.notificationItem} ${notification.readAt ? '' : styles.unread}`}
                key={notification.id}
                onClick={() => read(notification)}
              >
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
                <time>{relativeTime(notification.createdAt)}</time>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
