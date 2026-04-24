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
import ReceptionistApp from './apps/receptionist/App';
import EstimateView from './apps/estimate-view/EstimateView';
import PrivacyPolicy from './public/PrivacyPolicy';
import Terms from './public/Terms';
import { useBackButtonGuard } from './shared/lib/backButtonGuard';
import { dispatchBackNav } from './shared/lib/backNav';
import {
  PUBLIC_BUCKET, ADMIN_BUCKET,
  loadSession, saveSession, clearSession,
} from './shared/lib/authStorage';

// Admin uses its own storage bucket so a public login doesn't clobber
// an admin session and vice-versa. Admin is also reachable only via the
// hidden path below — typing a PIN on the normal login won't work.
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

  const isAdminRoute    = pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`);
  // Public, auth-less page for clients to view the estimate they were emailed.
  const isEstimateView  = pathname.startsWith('/estimate-view/');
  // Public legal pages — linked from the Twilio A2P 10DLC campaign and
  // from customer-facing emails/SMS. No login required.
  const isPrivacyPage   = pathname === '/privacy' || pathname === '/privacy-policy';
  const isTermsPage     = pathname === '/terms'   || pathname === '/terms-and-conditions';

  // ─── Admin session (hidden route) ─────────────────────────────────
  const [adminUser, setAdminUser] = useState(() => loadSession(ADMIN_BUCKET));

  const handleAdminLogin = (u, { remember = false } = {}) => {
    saveSession(ADMIN_BUCKET, u, remember);
    setAdminUser(u);
  };
  const handleAdminLogout = () => {
    clearSession(ADMIN_BUCKET);
    setAdminUser(null);
    // Send the admin back to the root so they can't accidentally share the hidden URL
    window.history.pushState({}, '', '/');
    setPathname('/');
  };

  // ─── Public session ───────────────────────────────────────────────
  const [user, setUser] = useState(() => loadSession(PUBLIC_BUCKET));

  const handleLogin = (u, { remember = false } = {}) => {
    saveSession(PUBLIC_BUCKET, u, remember);
    setUser(u);
  };
  const handleLogout = () => {
    clearSession(PUBLIC_BUCKET);
    setUser(null);
  };

  // Guard the browser back button once someone is logged in. Instead of
  // just pinning in place, we dispatch a synthetic back-nav event — each
  // role app registers a handler (via useBackNavHome) so back returns
  // the user to THEIR dashboard instead of trapping them on a sub-page.
  useBackButtonGuard(!!user || !!adminUser, (depth) => dispatchBackNav(depth));

  // ─── Render ───────────────────────────────────────────────────────
  if (isPrivacyPage) return <PrivacyPolicy />;
  if (isTermsPage)   return <Terms />;

  if (isEstimateView) {
    return <EstimateView />;
  }

  if (isAdminRoute) {
    if (!adminUser) return <AdminLogin onLogin={handleAdminLogin} />;
    return <AdminApp user={adminUser} onLogout={handleAdminLogout} />;
  }

  if (!user) return <Login onLogin={handleLogin} />;

  if (user.role === 'owner')        return <OwnerApp        user={user} onLogout={handleLogout} />;
  if (user.role === 'manager')      return <ManagerApp      user={user} onLogout={handleLogout} />;
  if (user.role === 'sales')        return <SalesApp        user={user} onLogout={handleLogout} />;
  if (user.role === 'salesperson')  return <SalesApp        user={user} onLogout={handleLogout} />; // legacy alias
  if (user.role === 'operations')   return <OperationsApp   user={user} onLogout={handleLogout} />;
  if (user.role === 'screen')       return <ScreenApp       user={user} onLogout={handleLogout} />;
  if (user.role === 'marketing')    return <MarketingApp    user={user} onLogout={handleLogout} />;
  if (user.role === 'receptionist') return <ReceptionistApp user={user} onLogout={handleLogout} />;

  // Admin is intentionally NOT accessible from the public route, even if
  // something seeds a sessionStorage value. Force logout.
  handleLogout();
  return <Login onLogin={handleLogin} />;
}
