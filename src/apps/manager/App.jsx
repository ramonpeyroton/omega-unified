import { useState } from 'react';
import Dashboard from './screens/Dashboard';
import PhaseView from './screens/PhaseView';
import PunchList from './screens/PunchList';
import Notifications from './screens/Notifications';
import Warehouse from './screens/Warehouse';
import JobOfTheDay from './screens/JobOfTheDay';
import Sidebar from './components/Sidebar';
import JarvisChat from '../../shared/components/JarvisChat';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import MaterialsRun from '../../shared/components/MaterialsRun';
import JobFullView from '../../shared/components/JobFullView';
import PipelineKanban from '../../shared/components/PipelineKanban';
import { useBackNavHome } from '../../shared/lib/backNav';

export default function App({ user, onLogout }) {
  // Gabriel lands on Job of the Day — his "what's happening now" screen.
  const [screen, setScreen] = useState('today');
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedPhases, setSelectedPhases] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [fullViewJob, setFullViewJob] = useState(null);

  const handleLogout = () => { onLogout(); };
  const navigate = (s) => {
    // Punch List requires a selected job; if not set, stay on current screen
    if (s === 'punch-list' && !selectedJob) return;
    setScreen(s);
  };

  // Browser back button → close any open overlay first, else fall back
  // to the "Today" home. `phase-board` also counts as an open screen
  // so back goes to Today, not to Jobs.
  useBackNavHome(() => {
    if (fullViewJob) { setFullViewJob(null); return; }
    if (screen === 'phase-board') { setScreen('today'); return; }
    if (screen !== 'today') setScreen('today');
  });

  // Tapping an Active Job from either Today or Dashboard jumps straight
  // into the phase breakdown (same UX in both places). We stash the job
  // so PhaseView can render it without a round-trip.
  function openJobPhases(job) {
    setSelectedJob(job);
    setSelectedPhases([]);
    setScreen('phase-board');
  }

  const renderScreen = () => {
    if (screen === 'today') {
      return (
        <JobOfTheDay
          user={user}
          onNavigate={navigate}
          onSelectJob={openJobPhases}
          onOpenFullJob={(job) => setFullViewJob(job)}
        />
      );
    }

    if (screen === 'materials-run') {
      return <MaterialsRun user={user} />;
    }

    if (screen === 'dashboard')
      return (
        <Dashboard
          user={user}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          onLogout={handleLogout}
          onNavigate={navigate}
          onSelectJob={(job, phases) => {
            setSelectedJob(job);
            setSelectedPhases(phases);
            setScreen('phase-board');
          }}
        />
      );

    if (screen === 'phase-board' && selectedJob)
      return (
        <PhaseView
          job={selectedJob}
          initialPhases={selectedPhases}
          user={user}
          onNavigate={navigate}
          darkMode={darkMode}
        />
      );

    if (screen === 'punch-list' && selectedJob)
      return <PunchList job={selectedJob} onNavigate={navigate} darkMode={darkMode} />;

    if (screen === 'notifications')
      return <Notifications user={user} onNavigate={navigate} darkMode={darkMode} />;

    if (screen === 'warehouse')
      return <Warehouse user={user} onNavigate={navigate} />;

    if (screen === 'calendar')
      return <CalendarScreen user={user} />;

    if (screen === 'pipeline') {
      // Read-only kanban — Gabriel can scan the board and click into a
      // card to read the basics (Details + Daily Logs) but he cannot
      // drag cards between phases nor open the full estimate/contract
      // tooling. JobFullView itself gates that via READ_ONLY_BASIC_ROLES.
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <PipelineKanban user={user} filterBySalesperson={false} readOnly />
        </div>
      );
    }


    return (
      <Dashboard
        user={user}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        onLogout={handleLogout}
        onNavigate={navigate}
        onSelectJob={(job, phases) => { setSelectedJob(job); setSelectedPhases(phases); setScreen('phase-board'); }}
      />
    );
  };

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <Sidebar
        screen={screen}
        onNavigate={navigate}
        onLogout={handleLogout}
        userName={user?.name}
        user={user}
        onOpenJob={(job) => setFullViewJob(job)}
      />
      {/* pb-16 on mobile leaves room for the bottom-bar navigation */}
      <main className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-0">
        {renderScreen()}
      </main>
      {/* JobFullView overlay kept for future entry points — currently unused. */}
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
