import { useState, useEffect } from 'react';
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
import JarvisChat from '../../shared/components/JarvisChat';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import FinanceScreen from '../../shared/components/Finance/FinanceScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import JobFullView from '../../shared/components/JobFullView';
import { useBackNavHome } from '../../shared/lib/backNav';

export default function App({ user, onLogout }) {
  const [screen, setScreen] = useState('dashboard');
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedPhases, setSelectedPhases] = useState([]);
  const [notifCount, setNotifCount] = useState(0);
  // JobFullView overlay — opened by clicks from the Daily Logs sidebar
  // cascade (Sprint 3 of the chat replacement). Independent from the
  // existing JobDetail screen so we don't disrupt the dashboard flow.
  const [fullViewJob, setFullViewJob] = useState(null);

  useEffect(() => {
    if (user) {
      loadNotifCount();
      const channel = supabase
        .channel('notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => loadNotifCount())
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
  }, [user]);

  async function loadNotifCount() {
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('seen', false);
    setNotifCount(count || 0);
  }

  const handleLogout = () => {
    setScreen('dashboard');
    onLogout();
  };

  const navigate = (s) => {
    setScreen(s);
    if (s === 'notifications') loadNotifCount();
  };

  // Back button → step out of detail screens first, then land on Dashboard.
  useBackNavHome(() => {
    if (screen === 'job-detail' || screen === 'assign-subs' || screen === 'estimate-flow') {
      setScreen('dashboard'); return;
    }
    if (screen !== 'dashboard') setScreen('dashboard');
  });

  const renderScreen = () => {
    switch (screen) {
      case 'dashboard':
        return (
          <Dashboard
            user={user}
            onSelectJob={(job) => { setSelectedJob(job); setScreen('job-detail'); }}
          />
        );
      case 'job-detail':
        if (!selectedJob) { setScreen('dashboard'); return null; }
        return (
          <JobDetail
            job={selectedJob}
            onJobUpdated={(updated) => setSelectedJob(updated)}
            onNavigate={navigate}
            onAssignSubs={async (job) => {
              const { data: phases } = await supabase.from('job_phases').select('*').eq('job_id', job.id).order('phase_index');
              setSelectedPhases(phases || []);
              setScreen('assign-subs');
            }}
          />
        );
      case 'assign-subs':
        if (!selectedJob) { setScreen('dashboard'); return null; }
        return <AssignSubs job={selectedJob} phases={selectedPhases} onNavigate={navigate} />;
      case 'subcontractors':
        return <Subcontractors />;
      case 'notifications':
        return <Notifications />;
      case 'project-analyzer':
        return <ProjectAnalyzer />;
      case 'warehouse':
        return <Warehouse />;
      case 'omega-brain':
        return <OmegaBrain />;
      case 'pipeline':
        return (
          <PipelineKanban
            user={user}
            filterBySalesperson={false}
            onOpenEstimateFlow={(job) => { setSelectedJob(job); setScreen('estimate-flow'); }}
          />
        );
      case 'calendar':
        return <CalendarScreen user={user} />;
      case 'finance':
        return <FinanceScreen user={user} />;
      case 'leads':
        return <LeadsList user={user} onBack={() => setScreen('dashboard')} />;
      case 'commissions':
        return <CommissionsScreen user={user} />;
      case 'estimate-flow':
        return selectedJob
          ? <EstimateFlow job={selectedJob} user={user} onBack={() => setScreen('pipeline')} />
          : <Dashboard user={user} onSelectJob={(job) => { setSelectedJob(job); setScreen('job-detail'); }} />;
      default:
        return <Dashboard user={user} onSelectJob={(job) => { setSelectedJob(job); setScreen('job-detail'); }} />;
    }
  };

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <Sidebar
        screen={screen}
        onNavigate={navigate}
        onLogout={handleLogout}
        notifCount={notifCount}
        userName={user.name}
        user={user}
        onOpenJob={(job) => setFullViewJob(job)}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderScreen()}
      </main>
      {fullViewJob && (
        <JobFullView
          job={fullViewJob}
          user={user}
          onClose={() => setFullViewJob(null)}
          onJobUpdated={(u) => setFullViewJob(u)}
          onJobDeleted={() => setFullViewJob(null)}
        />
      )}
      <JarvisChat user={user} />
    </div>
  );
}
