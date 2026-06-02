// Manager sub-app — migrated to URL-based routing (same pattern as
// Sales / Owner / Operations).
//
// Manager (Gabriel) lives on the phone, so the default landing route
// on small viewports is /receipts; tablet/desktop stays on / which is
// Job of the Day. A tiny mount-time effect handles that redirect once
// per session so refresh on any deeper URL is left alone.

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate, Outlet } from 'react-router-dom';

import Dashboard from './screens/Dashboard';
import PhaseView from './screens/PhaseView';
import PunchList from './screens/PunchList';
import Notifications from './screens/Notifications';
import Warehouse from './screens/Warehouse';
import JobOfTheDay from './screens/JobOfTheDay';
import QuickReceipts from './screens/QuickReceipts';
import Sidebar from './components/Sidebar';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import MaterialsRun from '../../shared/components/MaterialsRun';
import JobFullView from '../../shared/components/JobFullView';
import PipelineKanban from '../../shared/components/PipelineKanban';
import { supabase } from '../owner/lib/supabase';

// ─── Helpers ──────────────────────────────────────────────────────

function useJobById(id) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    supabase.from('jobs').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setJob(data);
        setLoading(false);
      });
    return () => { active = false; };
  }, [id]);
  return { job, setJob, loading };
}

function LoadingFallback() {
  return <div className="min-h-screen flex items-center justify-center text-omega-stone">Loading…</div>;
}

function screenIdFromPath(pathname) {
  if (pathname === '/' || pathname === '')      return 'today';
  if (pathname.startsWith('/dashboard'))        return 'dashboard';
  if (pathname.startsWith('/materials-run'))    return 'materials-run';
  if (pathname.startsWith('/receipts'))         return 'receipts';
  if (pathname.startsWith('/notifications'))    return 'notifications';
  if (pathname.startsWith('/warehouse'))        return 'warehouse';
  if (pathname.startsWith('/calendar'))         return 'calendar';
  if (pathname.startsWith('/pipeline'))         return 'pipeline';
  if (pathname.includes('/phase-board'))        return 'phase-board';
  if (pathname.includes('/punch-list'))         return 'punch-list';
  return null;
}

function navigateForId(navigate, id) {
  if (id === 'today' || id === 'home') return navigate('/');
  return navigate(`/${id}`);
}

// ─── Shell ─────────────────────────────────────────────────────────

function ManagerShell({ user, onLogout, darkMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screen = screenIdFromPath(location.pathname);

  return (
    <div className={`flex h-screen overflow-hidden ${darkMode ? 'bg-omega-charcoal' : 'bg-omega-cloud'}`}>
      <Sidebar
        screen={screen}
        onNavigate={(id) => navigateForId(navigate, id)}
        onLogout={onLogout}
        userName={user?.name}
        user={user}
        onOpenJob={(job, tab = 'daily') => navigate(`/jobs/${job.id}?tab=${tab}`, { state: { from: location.pathname } })}
      />
      <main className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
}

// ─── Mobile redirect — once on first mount ───────────────────────

function MobileRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== '/') return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 768px)').matches) {
      navigate('/receipts', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ─── Route components ─────────────────────────────────────────────

function TodayRoute({ user }) {
  const navigate = useNavigate();
  return (
    <>
      <MobileRedirect />
      <JobOfTheDay
        user={user}
        onNavigate={(id) => navigateForId(navigate, id)}
        onSelectJob={(job) => navigate(`/jobs/${job.id}/phase-board`, { state: { from: '/' } })}
        onOpenFullJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/' } })}
      />
    </>
  );
}

function DashboardRoute({ user, darkMode, setDarkMode, onLogout }) {
  const navigate = useNavigate();
  return (
    <Dashboard
      user={user}
      darkMode={darkMode}
      setDarkMode={setDarkMode}
      onLogout={onLogout}
      onNavigate={(id) => navigateForId(navigate, id)}
      onSelectJob={(job, phases) => {
        if (phases) sessionStorage.setItem(`manager:phases:${job.id}`, JSON.stringify(phases));
        navigate(`/jobs/${job.id}/phase-board`, { state: { from: '/dashboard' } });
      }}
    />
  );
}

function PhaseBoardRoute({ user, darkMode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);
  const initialPhases = JSON.parse(sessionStorage.getItem(`manager:phases:${id}`) || '[]');

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <PhaseView
      job={job}
      initialPhases={initialPhases}
      user={user}
      onNavigate={(id) => navigateForId(navigate, id)}
      darkMode={darkMode}
    />
  );
}

function PunchListRoute({ darkMode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return <PunchList job={job} onNavigate={(id) => navigateForId(navigate, id)} darkMode={darkMode} />;
}

function JobFullViewRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabHint = searchParams.get('tab');
  const { job, setJob, loading } = useJobById(id);

  const handleClose = () => {
    const from = location.state?.from;
    navigate(from || '/pipeline');
  };

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <JobFullView
      job={job}
      user={user}
      initialTab={tabHint}
      onClose={handleClose}
      onJobUpdated={(u) => setJob(u)}
      onJobDeleted={() => navigate('/')}
    />
  );
}

function PipelineRoute({ user }) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PipelineKanban
        user={user}
        filterBySalesperson={false}
        readOnly
        onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/pipeline' } })}
      />
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────

export default function App({ user, onLogout }) {
  const [darkMode, setDarkMode] = useState(false);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ManagerShell user={user} onLogout={onLogout} darkMode={darkMode} />}>
          <Route path="/"                          element={<TodayRoute user={user} />} />
          <Route path="/dashboard"                 element={<DashboardRoute user={user} darkMode={darkMode} setDarkMode={setDarkMode} onLogout={onLogout} />} />
          <Route path="/materials-run"             element={<MaterialsRun user={user} />} />
          <Route path="/receipts"                  element={<QuickReceipts user={user} />} />
          <Route path="/notifications"             element={<Notifications user={user} onNavigate={() => {}} darkMode={darkMode} />} />
          <Route path="/warehouse"                 element={<Warehouse user={user} />} />
          <Route path="/calendar"                  element={<CalendarScreen user={user} />} />
          <Route path="/pipeline"                  element={<PipelineRoute user={user} />} />
          <Route path="/jobs/:id"                  element={<JobFullViewRoute user={user} />} />
          <Route path="/jobs/:id/phase-board"      element={<PhaseBoardRoute user={user} darkMode={darkMode} />} />
          <Route path="/jobs/:id/punch-list"       element={<PunchListRoute darkMode={darkMode} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
