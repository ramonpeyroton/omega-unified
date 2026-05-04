import { useState } from 'react';
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
import JarvisChat from '../../shared/components/JarvisChat';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import { useBackNavHome } from '../../shared/lib/backNav';
import { ArrowLeft } from 'lucide-react';

export default function App(props) {
  // Render the screen tree, then overlay Jarvis so it appears on every
  // Sales route without refactoring the existing state-based router.
  return (
    <>
      <SalesRouter {...props} />
      <JarvisChat user={props.user} />
    </>
  );
}

function SalesRouter({ user, onLogout }) {
  const [screen, setScreen] = useState('home');
  const [currentJob, setCurrentJob] = useState(null);
  const [reportJob, setReportJob] = useState(null);
  const [reviewAnswers, setReviewAnswers] = useState(null);
  const [pdfContext, setPdfContext] = useState('');
  // When the seller hits "Start New Job for this Client" from a job
  // card, we land on `new-job` with the client info pre-filled. Cleared
  // on logout, after creation, or whenever they hit Home.
  const [newJobPrefill, setNewJobPrefill] = useState(null);

  const handleLogout = () => {
    setScreen('home');
    setCurrentJob(null);
    setReportJob(null);
    setPdfContext('');
    setNewJobPrefill(null);
    onLogout();
  };

  const navigate = (target) => {
    // Going home from anywhere clears the prefill so the next plain
    // "+ New Job" tap doesn't accidentally inherit the previous client.
    if (target === 'home') setNewJobPrefill(null);
    setScreen(target);
  };

  useBackNavHome(() => {
    if (screen !== 'home') setScreen('home');
  });

  if (screen === 'home')
    return <Home user={user} onNavigate={navigate} onLogout={handleLogout} />;

  if (screen === 'new-job')
    return (
      <NewJob
        user={user}
        onNavigate={navigate}
        prefilledClient={newJobPrefill}
        onJobCreated={(job) => {
          setCurrentJob(job);
          setReportJob(null);
          setPdfContext('');
          setNewJobPrefill(null);
          setScreen('pdf-upload');
        }}
      />
    );

  if (screen === 'pdf-upload' && currentJob)
    return (
      <PDFUpload
        job={currentJob}
        onSkip={() => { setPdfContext(''); setScreen('questionnaire'); }}
        onAnalyzed={(context) => { setPdfContext(context); setScreen('questionnaire'); }}
      />
    );

  if (screen === 'questionnaire' && currentJob)
    return (
      <Questionnaire
        job={currentJob}
        onNavigate={(target) => {
          if (target === 'home') navigate('home');
          else navigate(target);
        }}
        onJobUpdated={(updatedJob) => setCurrentJob(updatedJob)}
        onComplete={(updatedJob) => {
          // Skip the review step — go straight to Report which auto-generates
          // the AI report and saves a versioned row in job_reports.
          setCurrentJob(updatedJob);
          setReportJob(updatedJob);
          setReviewAnswers(null);
          setScreen('report');
        }}
      />
    );

  if (screen === 'review' && currentJob)
    return (
      <ReviewAnswers
        job={currentJob}
        answers={reviewAnswers || currentJob.answers || {}}
        onBack={() => setScreen('questionnaire')}
        onConfirm={(updatedJob) => {
          setCurrentJob(updatedJob);
          setReportJob(updatedJob);
          setReviewAnswers(null);
          setScreen('report');
        }}
      />
    );

  if (screen === 'report' && reportJob)
    return (
      <Report
        job={reportJob}
        pdfContext={pdfContext}
        onNavigate={(target) => {
          if (target === 'questionnaire') {
            if (reportJob) setCurrentJob(reportJob);
            setScreen('questionnaire');
          } else {
            navigate(target);
          }
        }}
      />
    );

  if (screen === 'pipeline') {
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setScreen('home')} className="inline-flex items-center gap-1 text-sm font-semibold text-omega-stone hover:text-omega-charcoal">
            <ArrowLeft className="w-4 h-4" /> Home
          </button>
        </div>
        <PipelineKanban
          user={user}
          filterBySalesperson={false}
          onOpenEstimateFlow={(job) => { setCurrentJob(job); setScreen('estimate-flow'); }}
          onOpenQuestionnaire={(job) => { setCurrentJob(job); setScreen('questionnaire'); }}
          onStartNewJobForClient={(clientData) => {
            setNewJobPrefill(clientData);
            setScreen('new-job');
          }}
        />
      </div>
    );
  }

  if (screen === 'estimate-flow' && currentJob)
    return <EstimateFlow job={currentJob} user={user} onBack={() => setScreen('pipeline')} />;

  if (screen === 'calendar')
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setScreen('home')} className="inline-flex items-center gap-1 text-sm font-semibold text-omega-stone hover:text-omega-charcoal">
            <ArrowLeft className="w-4 h-4" /> Home
          </button>
        </div>
        <CalendarScreen user={user} />
      </div>
    );

  if (screen === 'estimates')
    return (
      <Estimates
        onBack={() => setScreen('home')}
        onOpenEstimate={(job) => {
          if (!job) return;
          setCurrentJob(job);
          setScreen('estimate-flow');
        }}
      />
    );

  if (screen === 'notifications')
    return <Notifications onNavigate={navigate} />;

  if (screen === 'leads')
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setScreen('home')} className="inline-flex items-center gap-1 text-sm font-semibold text-omega-stone hover:text-omega-charcoal">
            <ArrowLeft className="w-4 h-4" /> Home
          </button>
        </div>
        <LeadsList user={user} onBack={() => setScreen('home')} />
      </div>
    );

  if (screen === 'commissions')
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setScreen('home')} className="inline-flex items-center gap-1 text-sm font-semibold text-omega-stone hover:text-omega-charcoal">
            <ArrowLeft className="w-4 h-4" /> Home
          </button>
        </div>
        <CommissionsScreen user={user} />
      </div>
    );

  if (screen === 'previous-jobs')
    return (
      <PreviousJobs
        user={user}
        onNavigate={navigate}
        onSelectJob={(job) => {
          setCurrentJob(job);
          setPdfContext('');
          if (job.report_raw) {
            setReportJob(job);
            setScreen('report');
          } else {
            setReportJob(null);
            setScreen('questionnaire');
          }
        }}
      />
    );

  // Fallback
  return <Home user={user} onNavigate={navigate} onLogout={handleLogout} />;
}
