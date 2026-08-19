// Operations sub-app — migrated to URL-based routing (same pattern as
// Sales and Owner). Persistent Sidebar shell, with
// <Routes> swapping the main content per URL. JobFullView is a real
// route so refresh and shared links preserve the open card. Back
// inside a card always goes to /pipeline.

import { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, GitBranch, DollarSign, FileText, MoreHorizontal } from 'lucide-react';

import Sidebar from './components/Sidebar';
import MobileMoreSheet from './components/MobileMoreSheet';
import Dashboard from './screens/Dashboard';
import ContractManager from './screens/ContractManager';
import SubcontractorManager from './screens/SubcontractorManager';
import PipelineKanban from '../../shared/components/PipelineKanban';
import EstimateFlow from '../../shared/components/EstimateFlow';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import FinanceScreen from '../../shared/components/Finance/FinanceScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import InvoiceInbox from '../../shared/components/InvoiceInbox';
import JobFullView from '../../shared/components/JobFullView';
import { useJobById } from '../../shared/hooks/useJobById';

function LoadingFallback() {
  return <div className="min-h-screen flex items-center justify-center text-omega-stone">Loading…</div>;
}

function screenIdFromPath(pathname) {
  if (pathname === '/' || pathname === '') return 'dashboard';
  if (pathname.startsWith('/pipeline'))       return 'pipeline';
  if (pathname.startsWith('/calendar'))       return 'calendar';
  if (pathname.startsWith('/finance'))        return 'finance';
  if (pathname.startsWith('/contracts'))      return 'contracts';
  if (pathname.startsWith('/subcontractors')) return 'subcontractors';
  if (pathname.startsWith('/invoice-inbox'))  return 'invoice-inbox';
  if (pathname.startsWith('/leads'))          return 'leads';
  if (pathname.startsWith('/commissions'))    return 'commissions';
  return null;
}

function navigateForId(navigate, id) {
  if (id === 'dashboard' || id === 'home') return navigate('/');
  return navigate(`/${id}`);
}

// ─── Mobile bottom bar ─────────────────────────────────────────────

const BOTTOM_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Home' },
  { id: 'pipeline',  icon: GitBranch,       label: 'Pipeline' },
  { id: 'finance',   icon: DollarSign,      label: 'Finance' },
  { id: 'contracts', icon: FileText,        label: 'Contracts' },
  { id: 'more',      icon: MoreHorizontal,  label: 'More' },
];

function MobileBottomBar({ screen, onNavigate, onMore }) {
  return (
    <nav aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex md:hidden safe-bottom">
      {BOTTOM_ITEMS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => (id === 'more' ? onMore() : onNavigate(id))}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[44px] ${
            screen === id ? 'text-omega-orange' : 'text-omega-stone'
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[10px] font-semibold">{label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Shell ─────────────────────────────────────────────────────────

function OperationsShell({ user, onLogout }) {
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
        userName={user.name}
        user={user}
        onOpenJob={(job, tab = 'daily') => navigate(`/jobs/${job.id}?tab=${tab}`, { state: { from: location.pathname } })}
      />
      <main className="flex-1 flex flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      <MobileBottomBar
        screen={screen}
        onNavigate={(id) => navigateForId(navigate, id)}
        onMore={() => setMoreOpen(true)}
      />
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

// ─── Route components ─────────────────────────────────────────────

function DashboardRoute({ user }) {
  const navigate = useNavigate();
  return (
    <Dashboard
      user={user}
      onOpenEstimate={(job) => navigate(`/jobs/${job.id}/estimate-flow`, { state: { from: '/' } })}
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

function LeadsRoute({ user }) {
  const navigate = useNavigate();
  return (
    <LeadsList
      user={user}
      onBack={() => navigate('/')}
      onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/leads' } })}
    />
  );
}

function JobFullViewRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabHint = searchParams.get('tab');
  const { job, setJob, loading } = useJobById(id);

  // Back: state.from if set, otherwise /pipeline (Ramon rule).
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
      onOpenEstimateFlow={(j) => navigate(`/jobs/${j.id}/estimate-flow`, { state: { from: location.pathname + location.search } })}
    />
  );
}

function EstimateFlowRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return <EstimateFlow job={job} user={user} onBack={() => navigate('/')} />;
}

// ─── Root ────────────────────────────────────────────────────────

export default function App({ user, onLogout }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<OperationsShell user={user} onLogout={onLogout} />}>
          <Route path="/"                          element={<DashboardRoute user={user} />} />
          <Route path="/pipeline"                  element={<PipelineRoute user={user} />} />
          <Route path="/calendar"                  element={<CalendarScreen user={user} />} />
          <Route path="/finance"                   element={<FinanceScreen user={user} />} />
          <Route path="/contracts"                 element={<ContractManager user={user} />} />
          <Route path="/subcontractors"            element={<SubcontractorManager user={user} />} />
          <Route path="/invoice-inbox"             element={<InvoiceInbox user={user} />} />
          <Route path="/leads"                     element={<LeadsRoute user={user} />} />
          <Route path="/commissions"               element={<CommissionsScreen user={user} />} />
          <Route path="/jobs/:id"                  element={<JobFullViewRoute user={user} />} />
          <Route path="/jobs/:id/estimate-flow"    element={<EstimateFlowRoute user={user} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
