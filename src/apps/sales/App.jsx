// Sales sub-app — first one migrated to URL-based routing.
//
// Before: useState('screen') drove everything; refresh + back button
// always landed on the dashboard. Now: BrowserRouter owns navigation,
// each screen has its own path, and the JobFullView opens via
// /jobs/:id?tab=X so the link can be shared and a hard refresh
// brings you back to the exact same job you were looking at.
//
// Route map:
//   /                            → Home dashboard
//   /pipeline                    → PipelineKanban
//   /calendar                    → CalendarScreen
//   /estimates                   → Estimates list
//   /notifications               → Notifications screen
//   /leads                       → LeadsList
//   /commissions                 → CommissionsScreen
//   /previous-jobs               → PreviousJobs
//   /new-job                     → NewJob (optional ?clientId= prefill)
//   /jobs/:id                    → JobFullView overlay (tab via ?tab=)
//   /jobs/:id/questionnaire      → Questionnaire flow
//   /jobs/:id/pdf-upload         → PDF upload step
//   /jobs/:id/review             → Review answers step
//   /jobs/:id/report             → Project report
//   /jobs/:id/estimate-flow      → EstimateFlow wizard
//
// vercel.json was updated with the matching rewrites so any of these
// paths on a fresh load (refresh, shared link) survive the round-trip.

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import Home from './screens/Home';
import NewJob from './screens/NewJob';
import PDFUpload from './screens/PDFUpload';
import Questionnaire from './screens/Questionnaire';
import ReviewAnswers from './screens/ReviewAnswers';
import Report from './screens/Report';
import PreviousJobs from './screens/PreviousJobs';
import Estimates from './screens/Estimates';
import Notifications from './screens/Notifications';
import PipelineKanban from '../../shared/components/PipelineKanban';
import EstimateFlow from '../../shared/components/EstimateFlow';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import JobFullView from '../../shared/components/JobFullView';
import { supabase } from './lib/supabase';

// ─── Shared helpers ───────────────────────────────────────────────

// Fetch a job by id from the URL. Stays in a loading state until
// Supabase replies; bounces to Home if the row doesn't exist.
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

// Bar that sits on top of the screens that don't have their own
// header (Pipeline, Calendar, Leads, Commissions).
function BackBar() {
  const navigate = useNavigate();
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1 text-sm font-semibold text-omega-stone hover:text-omega-charcoal"
      >
        <ArrowLeft className="w-4 h-4" /> Home
      </button>
    </div>
  );
}

// ─── Route wrappers ───────────────────────────────────────────────

function HomeRoute({ user, onLogout }) {
  const navigate = useNavigate();
  return (
    <Home
      user={user}
      onLogout={onLogout}
      onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)}
      onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`)}
    />
  );
}

function NewJobRoute({ user }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Prefill comes via query — when the seller clicks "Start New Job"
  // from a client card we stash the data in sessionStorage keyed by
  // a random token so the URL stays clean.
  const prefillToken = searchParams.get('prefill');
  const prefilledClient = prefillToken
    ? JSON.parse(sessionStorage.getItem(`prefill:${prefillToken}`) || 'null')
    : null;

  return (
    <NewJob
      user={user}
      onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)}
      prefilledClient={prefilledClient}
      onJobCreated={() => {
        if (prefillToken) sessionStorage.removeItem(`prefill:${prefillToken}`);
        navigate('/');
      }}
    />
  );
}

function PipelineRoute({ user }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      <BackBar />
      <PipelineKanban
        user={user}
        filterBySalesperson={false}
        onOpenEstimateFlow={(job) => navigate(`/jobs/${job.id}/estimate-flow`)}
        onOpenQuestionnaire={(job) => navigate(`/jobs/${job.id}/questionnaire`)}
        onStartNewJobForClient={(clientData) => {
          // Stash the prefill in sessionStorage so the URL doesn't
          // explode with embedded JSON.
          const token = Math.random().toString(36).slice(2, 10);
          sessionStorage.setItem(`prefill:${token}`, JSON.stringify(clientData));
          navigate(`/new-job?prefill=${token}`);
        }}
      />
    </div>
  );
}

function CalendarRoute({ user }) {
  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      <BackBar />
      <CalendarScreen user={user} />
    </div>
  );
}

function EstimatesRoute({ user }) {
  const navigate = useNavigate();
  return (
    <Estimates
      onBack={() => navigate('/')}
      onOpenEstimate={(job) => {
        if (!job) return;
        navigate(`/jobs/${job.id}?tab=estimate`);
      }}
    />
  );
}

function NotificationsRoute({ user }) {
  const navigate = useNavigate();
  return (
    <Notifications
      user={user}
      onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)}
      onOpenJob={(job, tab = 'daily') => navigate(`/jobs/${job.id}?tab=${tab}`)}
    />
  );
}

function LeadsRoute({ user }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      <BackBar />
      <LeadsList
        user={user}
        onBack={() => navigate('/')}
        onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`)}
      />
    </div>
  );
}

function CommissionsRoute({ user }) {
  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      <BackBar />
      <CommissionsScreen user={user} />
    </div>
  );
}

function PreviousJobsRoute({ user }) {
  const navigate = useNavigate();
  return (
    <PreviousJobs
      user={user}
      onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)}
      onSelectJob={(job) => {
        if (job.report_raw) navigate(`/jobs/${job.id}/report`);
        else                navigate(`/jobs/${job.id}/questionnaire`);
      }}
    />
  );
}

function JobFullViewRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabHint = searchParams.get('tab');
  const { job, setJob, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <JobFullView
      job={job}
      user={user}
      initialTab={tabHint}
      onClose={() => navigate(-1)}
      onJobUpdated={(u) => setJob(u)}
      onJobDeleted={() => navigate('/')}
      onOpenEstimateFlow={(j) => navigate(`/jobs/${j.id}/estimate-flow`)}
      onOpenQuestionnaire={(j) => navigate(`/jobs/${j.id}/questionnaire`)}
      onStartNewJobForClient={(clientData) => {
        const token = Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(`prefill:${token}`, JSON.stringify(clientData));
        navigate(`/new-job?prefill=${token}`);
      }}
    />
  );
}

function QuestionnaireRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, setJob, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <Questionnaire
      job={job}
      onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)}
      onJobUpdated={(u) => setJob(u)}
      onComplete={(updated) => navigate(`/jobs/${updated.id}/report`)}
    />
  );
}

function PDFUploadRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <PDFUpload
      job={job}
      onSkip={() => navigate(`/jobs/${id}/questionnaire`)}
      onAnalyzed={(context) => {
        // pdfContext used to live in App state. Now we pass it via
        // sessionStorage keyed by job id so a refresh keeps it.
        sessionStorage.setItem(`pdfContext:${id}`, context);
        navigate(`/jobs/${id}/questionnaire`);
      }}
    />
  );
}

function ReviewAnswersRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, setJob, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <ReviewAnswers
      job={job}
      answers={job.answers || {}}
      onBack={() => navigate(`/jobs/${id}/questionnaire`)}
      onConfirm={(updated) => {
        setJob(updated);
        navigate(`/jobs/${updated.id}/report`);
      }}
    />
  );
}

function ReportRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);
  const pdfContext = sessionStorage.getItem(`pdfContext:${id}`) || '';

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return (
    <Report
      job={job}
      pdfContext={pdfContext}
      onNavigate={(target) => {
        if (target === 'questionnaire') navigate(`/jobs/${id}/questionnaire`);
        else if (target === 'home')     navigate('/');
        else                            navigate(`/${target}`);
      }}
    />
  );
}

function EstimateFlowRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { job, loading } = useJobById(id);

  if (loading) return <LoadingFallback />;
  if (!job) return <Navigate to="/" replace />;

  return <EstimateFlow job={job} user={user} onBack={() => navigate(-1)} />;
}

// ─── Root ────────────────────────────────────────────────────────

export default function App({ user, onLogout }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                            element={<HomeRoute user={user} onLogout={onLogout} />} />
        <Route path="/pipeline"                    element={<PipelineRoute user={user} />} />
        <Route path="/calendar"                    element={<CalendarRoute user={user} />} />
        <Route path="/estimates"                   element={<EstimatesRoute user={user} />} />
        <Route path="/notifications"               element={<NotificationsRoute user={user} />} />
        <Route path="/leads"                       element={<LeadsRoute user={user} />} />
        <Route path="/commissions"                 element={<CommissionsRoute user={user} />} />
        <Route path="/previous-jobs"               element={<PreviousJobsRoute user={user} />} />
        <Route path="/new-job"                     element={<NewJobRoute user={user} />} />
        <Route path="/jobs/:id"                    element={<JobFullViewRoute user={user} />} />
        <Route path="/jobs/:id/questionnaire"      element={<QuestionnaireRoute user={user} />} />
        <Route path="/jobs/:id/pdf-upload"         element={<PDFUploadRoute />} />
        <Route path="/jobs/:id/review"             element={<ReviewAnswersRoute user={user} />} />
        <Route path="/jobs/:id/report"             element={<ReportRoute user={user} />} />
        <Route path="/jobs/:id/estimate-flow"      element={<EstimateFlowRoute user={user} />} />
        {/* Catch-all → home */}
        <Route path="*"                            element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
