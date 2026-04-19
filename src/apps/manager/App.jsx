import { useState } from 'react';
import Dashboard from './screens/Dashboard';
import PhaseBoard from './screens/PhaseBoard';
import PunchList from './screens/PunchList';
import Notifications from './screens/Notifications';
import Warehouse from './screens/Warehouse';
import Calendar from './screens/Calendar';
import JarvisChat from '../../shared/components/JarvisChat';

export default function App({ user, onLogout }) {
  const [screen, setScreen] = useState('dashboard');
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedPhases, setSelectedPhases] = useState([]);
  const [darkMode, setDarkMode] = useState(false);

  const handleLogout = () => { onLogout(); };
  const navigate = (s) => setScreen(s);

  const renderScreen = () => {
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
        <PhaseBoard
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
      return <Notifications onNavigate={navigate} darkMode={darkMode} />;

    if (screen === 'warehouse')
      return <Warehouse user={user} onNavigate={navigate} />;

    if (screen === 'calendar')
      return <Calendar user={user} onNavigate={navigate} />;

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
    <>
      {renderScreen()}
      <JarvisChat user={user} />
    </>
  );
}
