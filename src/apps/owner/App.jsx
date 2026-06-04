// Owner sub-app — migrated to URL-based routing (same pattern as Sales).
//
// The Sidebar + MobileBottomBar wrap a persistent layout
// shell; the <Routes> inside the <main> swap per URL. The JobFullView
// becomes a real route (/jobs/:id?tab=X) so refresh and shared links
// preserve the open card. Back from a job ALWAYS lands on /pipeline,
// per Ramon's rule.

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate } from 'react-router-dom';

import Dashboard from './screens/Dashboard';
import JobDetail from './screens/JobDetail';
import AssignSubs from './screens/AssignSubs';
import Subcontractors from './screens/Subcontractors';
import Notifications from './screens/Notifications';
import ProjectAnalyzer from './screens/ProjectAnalyzer';
import Warehouse from './screens/Warehouse';
import OmegaBrain from './screens/OmegaBrain';
import Sidebar from './components/Sidebar';
import { supabase } from './lib/supabase';
import PipelineKanban from '../../shared/components/PipelineKanban';
import EstimateFlow from '../../shared/components/EstimateFlow';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import FinanceScreen from '../../shared/components/Finance/FinanceScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import JobFullView from '../../shared/components/JobFullView';
import MobileDailyLogs from '../../shared/components/MobileDailyLogs';
import Questionnaire from '../sales/screens/Questionnaire';
import PageHeader from '../../shared/components/ui/PageHeader';
import MobileMoreSheet from './components/MobileMoreSheet';
import { LayoutDashboard, GitBranch, DollarSign, Bell, Calendar, MessageCircle, MoreHorizontal } from 'lucide-react';

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

// Maps the current URL pathname to the legacy `screen` id the
// Sidebar / MobileBottomBar use for the active-state highlight.
function screenIdFromPath(pathname) {
  if (pathname === '/' || pathname === '') return 'dashboard';
  if (pathname.startsWith('/pipeline')) return 'pipeline';
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/finance')) return 'finance';
  if (pathname.startsWith('/notifications')) return 'notifications';
  if (pathname.startsWith('/subcontractors')) return 'subcontractors';
  if (pathname.startsWith('/project-analyzer')) return 'project-analyzer';
  if (pathname.startsWith('/warehouse')) return 'warehouse';
  if (pathname.startsWith('/omega-brain')) return 'omega-brain';
  if (pathname.startsWith('/leads')) return 'leads';
  if (pathname.startsWith('/commissions')) return 'commissions';
  if (pathname.startsWith('/daily-logs')) return 'daily-logs';
  return null; // job pages, etc — no sidebar highlight
}

function navigateForId(navigate, id) {
  if (id === 'dashboard' || id === 'home') return navigate('/');
  return navigate(`/${id}`);
}

// ─── Mobile bottom bar — uses location instead of state ───────────

function MobileBottomBar({ notifCount, onMore }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screen = screenIdFromPath(location.pathname);

  const items = [
    { id: 'dashboard',  icon: LayoutDashboard, label: 'Home' },
    { id: 'pipeline',   icon: GitBranch,        label: 'Pipeline' },
    { id: 'finance',    icon: DollarSign,        label: 'Finance' },
    { id: 'calendar',   icon: Calendar,          label: 'Calendar' },
    { id: 'daily-logs', icon: MessageCircle,     label: 'Logs' },
    { id: 'notifications', icon: Bell,           label: 'Alerts', badge: notifCount },
    { id: 'more',       icon: MoreHorizontal,    label: 'More' },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex md:hidden">
      {items.map(({ id, icon: Icon, label, badge }) => (
        <button
          key={id}
          onClick={() => (id === 'more' ? onMore?.() : navigateForId(navigate, id))}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative ${
            screen === id ? 'text-omega-orange' : 'text-omega-stone'
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[10px] font-semibold">{label}</span>
          {badge > 0 && (
            <span className="absolute top-1 right-[18%] min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold rounded-full bg-omega-orange text-white">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

// ─── Layout shell that wraps every route ──────────────────────────

function OwnerShell({ user, notifCount, onLogout, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screen = screenIdFromPath(location.pathname);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <Sidebar
        screen={screen}
        onNavigate={(id) => navigateForId(navigate, id)}
        onLogout={onLogout}
        notifCount={notifCount}
        userName={user.name}
        user={user}
        onOpenJob={(job, tab = 'daily') => navigate(`/jobs/${job.id}?tab=${tab}`, { state: { from: location.pathname } })}
      />
      <main className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-0">
        {children}
      </main>
      <MobileBottomBar notifCount={notifCount} onMore={() => setMoreOpen(true)} />
      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onNavigate={(id) => navigateForId(navigate, id)}
        user={user}
        onLogout={onLogout}
      />
    </div>
  );
}

// ─── Route wrappers ───────────────────────────────────────────────

function DashboardRoute({ user }) {
  const navigate = useNavigate();
  return (
    <Dashboard
      user={user}
      onSelectJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/' } })}
      onNavigate={(id) => navigateForId(navigate, id)}
    />
  );
}

function PipelineRoute({ user }) {
  const navigate = useNavigate();
  return (
    <PipelineKanban
      user={user}
      filterBySalesperson={false}
      onBack={() => navigate('/')}
      onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/pipeline' } })}
      onOpenEstimateFlow={(job) => navigate(`/jobs/${job.id}/estimate-flow`, { state: { from: '/pipeline' } })}
    />
  );
}

function CalendarRoute({ user }) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PageHeader icon={Calendar} title="Calendar" subtitle="Visits, follow-ups, and events" onBack={() => navigate('/')} />
      <div className="flex-1 min-h-0 overflow-hidden"><CalendarScreen user={user} /></div>
    </div>
  );
}
function FinanceRoute({ user }) {
  const navigate = useNavigate();
  return <FinanceScreen user={user} onBack={() => navigate('/')} />;
}
function NotificationsRoute()   { const navigate = useNavigate(); return <Notifications onBack={() => navigate('/')} />; }
function SubcontractorsRoute()  { const navigate = useNavigate(); return <Subcontractors onBack={() => navigate('/')} />; }
function ProjectAnalyzerRoute() { const navigate = useNavigate(); return <ProjectAnalyzer onBack={() => navigate('/')} />; }
function WarehouseRoute()       { const navigate = useNavigate(); return <Warehouse onBack={() => navigate('/')} />; }
function OmegaBrainRoute()      { const navigate = useNavigate(); return <OmegaBrain onBack={() => navigate('/')} />; }
function CommissionsRoute({ user })    { return <CommissionsScreen user={user} />; }

function LeadsRoute({ user }) {
  const navigate = useNavigate();
  return <LeadsList user={user} onBack={() => navigate('/')} onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/leads' } })} />;
}

function JobFullViewRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabHint = searchParams.get('tab');
  const { job, setJob, loading } = useJobById(id);

  // Back: state.from if set, otherwise always /pipeline (Ramon rule).
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
      onOpenQuestionnaire={(j) => navigate(`/jobs/${j.id}/questionnaire`, { state: { from: location.pathname + location.search } })}
      onOpenEstimateFlow={(j) => navigate(`/jobs/${j.id}/estimate-flow`, { state: { from: location.pathname + location.search } })}
    />
  );
}

function JobDetailRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, setJob, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <JobDetail
      job={job}
      onJobUpdated={(u) => setJob(u)}
      onNavigate={(id) => navigateForId(navigate, id)}
      onAssignSubs={async (j) => {
        // Phases are still fetched here so the AssignSubs screen has
        // them on first render; we stash them via sessionStorage so
        // the route component doesn't have to re-fetch.
        const { data: phases } = await supabase.from('job_phases').select('*').eq('job_id', j.id).order('phase_index');
        sessionStorage.setItem(`assignSubs:phases:${j.id}`, JSON.stringify(phases || []));
        navigate(`/jobs/${j.id}/assign-subs`);
      }}
    />
  );
}

function AssignSubsRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);
  const phases = JSON.parse(sessionStorage.getItem(`assignSubs:phases:${id}`) || '[]');

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return <AssignSubs job={job} phases={phases} onNavigate={(id) => navigateForId(navigate, id)} />;
}

function EstimateFlowRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return <EstimateFlow job={job} user={user} onBack={() => navigate('/pipeline')} />;
}

function QuestionnaireRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, setJob, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <Questionnaire
      job={job}
      onNavigate={() => navigate('/')}
      onJobUpdated={(u) => setJob(u)}
      onComplete={(updated) => { setJob(updated); navigate('/'); }}
    />
  );
}

// ─── Root ────────────────────────────────────────────────────────

function OwnerRoutes({ user, onLogout, notifCount }) {
  return (
    <Routes>
      {/* Routes that render INSIDE the OwnerShell (Sidebar persists). */}
      <Route element={<OwnerShellWrapper user={user} onLogout={onLogout} notifCount={notifCount} />}>
        <Route path="/"                element={<DashboardRoute user={user} />} />
        <Route path="/pipeline"        element={<PipelineRoute user={user} />} />
        <Route path="/calendar"        element={<CalendarRoute user={user} />} />
        <Route path="/finance"         element={<FinanceRoute user={user} />} />
        <Route path="/notifications"   element={<NotificationsRoute />} />
        <Route path="/subcontractors"  element={<SubcontractorsRoute />} />
        <Route path="/project-analyzer" element={<ProjectAnalyzerRoute />} />
        <Route path="/warehouse"       element={<WarehouseRoute />} />
        <Route path="/omega-brain"     element={<OmegaBrainRoute />} />
        <Route path="/leads"           element={<LeadsRoute user={user} />} />
        <Route path="/commissions"     element={<CommissionsRoute user={user} />} />
        <Route path="/daily-logs"      element={<MobileDailyLogs user={user} />} />
      </Route>

      {/* Job-scoped routes also live inside the shell so the Sidebar
          stays visible while the user is looking at a card. */}
      <Route element={<OwnerShellWrapper user={user} onLogout={onLogout} notifCount={notifCount} />}>
        <Route path="/jobs/:id"                 element={<JobFullViewRoute user={user} />} />
        <Route path="/jobs/:id/job-detail"      element={<JobDetailRoute user={user} />} />
        <Route path="/jobs/:id/assign-subs"     element={<AssignSubsRoute />} />
        <Route path="/jobs/:id/estimate-flow"   element={<EstimateFlowRoute user={user} />} />
        <Route path="/jobs/:id/questionnaire"   element={<QuestionnaireRoute />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// React Router v6 nested layout helper — keeps OwnerShell mounted
// between route swaps so the Sidebar doesn't re-mount
// on every nav.
import { Outlet } from 'react-router-dom';
function OwnerShellWrapper({ user, onLogout, notifCount }) {
  return (
    <OwnerShell user={user} onLogout={onLogout} notifCount={notifCount}>
      <Outlet />
    </OwnerShell>
  );
}

export default function App({ user, onLogout }) {
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    loadNotifCount();
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => loadNotifCount())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user]);

  async function loadNotifCount() {
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('seen', false);
    setNotifCount(count || 0);
  }

  return (
    <BrowserRouter>
      <OwnerRoutes user={user} onLogout={onLogout} notifCount={notifCount} />
    </BrowserRouter>
  );
}
