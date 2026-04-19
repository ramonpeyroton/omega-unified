import { useState, useEffect } from 'react';
import Login from './Login';
import AdminLogin from './AdminLogin';
import OwnerApp from './apps/owner/App';
import ManagerApp from './apps/manager/App';
import SalesApp from './apps/sales/App';
import OperationsApp from './apps/operations/App';
import AdminApp from './apps/admin/App';
import ScreenApp from './apps/screen/App';
import MarketingApp from './apps/marketing/App';
import { useBackButtonGuard } from './shared/lib/backButtonGuard';

// Admin uses its own sessionStorage bucket so a public login doesn't clobber
// an admin session and vice-versa. Admin is also reachable only via the
// hidden path below — typing a PIN on the normal login won't work.
const STORAGE_KEY = 'omega_unified_user';
const ADMIN_STORAGE_KEY = 'omega_unified_admin';
const ADMIN_PATH = '/admin-x9k2';

export default function App() {
  // Track pathname so a deep-link to /admin-x9k2 routes to AdminLogin.
  // Listens to popstate in case the user uses the back/forward button.
  const [pathname, setPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const isAdminRoute = pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`);

  // ─── Admin session (hidden route) ─────────────────────────────────
  const [adminUser, setAdminUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(ADMIN_STORAGE_KEY)); } catch { return null; }
  });

  const handleAdminLogin = (u) => {
    sessionStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(u));
    setAdminUser(u);
  };
  const handleAdminLogout = () => {
    sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    setAdminUser(null);
    // Send the admin back to the root so they can't accidentally share the hidden URL
    window.history.pushState({}, '', '/');
    setPathname('/');
  };

  // ─── Public session ───────────────────────────────────────────────
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch { return null; }
  });

  const handleLogin = (u) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
  };
  const handleLogout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  // Guard the browser back button once someone is logged in. The back
  // button should never exit the SPA — if pressed, the user stays on the
  // current screen. Internal navigation isn't affected because we don't
  // push to history for it.
  useBackButtonGuard(!!user || !!adminUser);

  // ─── Render ───────────────────────────────────────────────────────
  if (isAdminRoute) {
    if (!adminUser) return <AdminLogin onLogin={handleAdminLogin} />;
    return <AdminApp user={adminUser} onLogout={handleAdminLogout} />;
  }

  if (!user) return <Login onLogin={handleLogin} />;

  if (user.role === 'owner')      return <OwnerApp       user={user} onLogout={handleLogout} />;
  if (user.role === 'manager')    return <ManagerApp     user={user} onLogout={handleLogout} />;
  if (user.role === 'sales')      return <SalesApp       user={user} onLogout={handleLogout} />;
  if (user.role === 'salesperson') return <SalesApp      user={user} onLogout={handleLogout} />; // legacy alias
  if (user.role === 'operations') return <OperationsApp  user={user} onLogout={handleLogout} />;
  if (user.role === 'screen')     return <ScreenApp      user={user} onLogout={handleLogout} />;
  if (user.role === 'marketing')  return <MarketingApp   user={user} onLogout={handleLogout} />;

  // Admin is intentionally NOT accessible from the public route, even if
  // something seeds a sessionStorage value. Force logout.
  handleLogout();
  return <Login onLogin={handleLogin} />;
}
