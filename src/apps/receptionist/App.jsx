// Receptionist sub-app — migrated to URL-based routing.
//
// Calendar is the default landing; everything else has its own URL.
// JobFullView opens via /jobs/:id so deep links and refresh survive.
// The "pending visit" sticky banner (rehydrated from sessionStorage)
// keeps working across navigations.

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate, Outlet } from 'react-router-dom';

import NewLead from './screens/NewLead';
import LeadsList from './screens/LeadsList';
import Sidebar from './components/Sidebar';
import PendingVisitBanner from './components/PendingVisitBanner';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import PipelineKanban from '../../shared/components/PipelineKanban';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import JobFullView from '../../shared/components/JobFullView';
import { supabase } from '../owner/lib/supabase';

const PENDING_VISIT_KEY = 'omega_receptionist_pending_visit';

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
      })
      .catch(() => {
        if (!active) return;
        setJob(null);
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
  if (pathname === '/' || pathname === '')   return 'calendar';
  if (pathname.startsWith('/new-lead'))      return 'new-lead';
  if (pathname.startsWith('/leads'))         return 'leads';
  if (pathname.startsWith('/commissions'))   return 'commissions';
  if (pathname.startsWith('/pipeline'))      return 'pipeline';
  return null;
}

function navigateForId(navigate, id) {
  if (id === 'calendar' || id === 'home') return navigate('/');
  return navigate(`/${id}`);
}

// ─── Shell ─────────────────────────────────────────────────────────

function ReceptionistShell({ user, onLogout, scheduleJob, setScheduleJob }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screen = screenIdFromPath(location.pathname);

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <Sidebar
        screen={screen}
        onNavigate={(id) => navigateForId(navigate, id)}
        onLogout={onLogout}
        userName={user?.name}
        user={user}
        onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: location.pathname } })}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {scheduleJob && screen !== 'calendar' && (
          <PendingVisitBanner
            job={scheduleJob}
            onContinue={() => navigate('/')}
            onDismiss={() => setScheduleJob(null)}
          />
        )}
        <Outlet />
      </main>
    </div>
  );
}

// ─── Route components ─────────────────────────────────────────────

function CalendarRoute({ user, scheduleJob, onVisitScheduled }) {
  return (
    <CalendarScreen
      user={user}
      initialJobForVisit={scheduleJob}
      onVisitScheduled={onVisitScheduled}
    />
  );
}

function NewLeadRoute({ user, onLogout, setScheduleJob }) {
  const navigate = useNavigate();
  return (
    <NewLead
      user={user}
      onLogout={onLogout}
      onViewLeads={() => navigate('/leads')}
      onScheduleVisit={(job) => {
        setScheduleJob(job);
        navigate('/');
      }}
    />
  );
}

function LeadsRoute({ user, onLogout }) {
  const navigate = useNavigate();
  return (
    <LeadsList
      user={user}
      onBack={() => navigate('/new-lead')}
      onLogout={onLogout}
      onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/leads' } })}
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
        onBack={() => navigate('/')}
        onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/pipeline' } })}
      />
    </div>
  );
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

// ─── Root ────────────────────────────────────────────────────────

export default function App({ user, onLogout }) {
  // Rehydrate any pending visit context from sessionStorage so a hard
  // reload doesn't drop the receptionist's in-flight workflow.
  const [scheduleJob, setScheduleJobRaw] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(PENDING_VISIT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  function setScheduleJob(j) {
    setScheduleJobRaw(j);
    try {
      if (j) sessionStorage.setItem(PENDING_VISIT_KEY, JSON.stringify(j));
      else   sessionStorage.removeItem(PENDING_VISIT_KEY);
    } catch { /* ignore quota errors */ }
  }
  const handleVisitScheduled = () => setScheduleJob(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ReceptionistShell user={user} onLogout={onLogout} scheduleJob={scheduleJob} setScheduleJob={setScheduleJob} />}>
          <Route path="/"                element={<CalendarRoute user={user} scheduleJob={scheduleJob} onVisitScheduled={handleVisitScheduled} />} />
          <Route path="/new-lead"        element={<NewLeadRoute user={user} onLogout={onLogout} setScheduleJob={setScheduleJob} />} />
          <Route path="/leads"           element={<LeadsRoute user={user} onLogout={onLogout} />} />
          <Route path="/commissions"     element={<CommissionsScreen user={user} />} />
          <Route path="/pipeline"        element={<PipelineRoute user={user} />} />
          <Route path="/jobs/:id"        element={<JobFullViewRoute user={user} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
