import { AppShell } from '../../components/AppShell';
import { AuthGate } from '../../components/AuthContext';

/**
 * Everything inside the (app) route group requires a session. The auth routes
 * live outside this group so the gate cannot redirect them back to itself.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
