import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './screens/Dashboard';
import ContractManager from './screens/ContractManager';
import SubcontractorManager from './screens/SubcontractorManager';
import PipelineKanban from '../../shared/components/PipelineKanban';
import EstimateFlow from '../../shared/components/EstimateFlow';
import JarvisChat from '../../shared/components/JarvisChat';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import FinanceScreen from '../../shared/components/Finance/FinanceScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import { useBackNavHome } from '../../shared/lib/backNav';

export default function App({ user, onLogout }) {
  const [screen, setScreen] = useState('dashboard');
  const [selectedJob, setSelectedJob] = useState(null);

  const navigate = (s) => setScreen(s);

  useBackNavHome(() => {
    if (screen !== 'dashboard') setScreen('dashboard');
  });

  const handleLogout = () => {
    setScreen('dashboard');
    setSelectedJob(null);
    onLogout();
  };

  const openEstimate = (job) => {
    setSelectedJob(job);
    setScreen('estimate-flow');
  };

  const renderScreen = () => {
    switch (screen) {
      case 'dashboard':
        return <Dashboard onOpenEstimate={openEstimate} onNavigate={navigate} user={user} />;
      case 'estimate-flow':
        return selectedJob
          ? <EstimateFlow job={selectedJob} user={user} onBack={() => setScreen('dashboard')} />
          : <Dashboard onOpenEstimate={openEstimate} onNavigate={navigate} user={user} />;
      case 'contracts':
        return <ContractManager user={user} />;
      case 'subcontractors':
        return <SubcontractorManager user={user} />;
      case 'pipeline':
        return <PipelineKanban user={user} filterBySalesperson={false} onOpenEstimateFlow={openEstimate} />;
      case 'calendar':
        return <CalendarScreen user={user} />;
      case 'finance':
        return <FinanceScreen user={user} />;
      case 'leads':
        return <LeadsList user={user} onBack={() => setScreen('dashboard')} />;
      default:
        return <Dashboard onOpenEstimate={openEstimate} onNavigate={navigate} user={user} />;
    }
  };

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <Sidebar
        screen={screen}
        onNavigate={navigate}
        onLogout={handleLogout}
        userName={user.name}
        user={user}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderScreen()}
      </main>
      <JarvisChat user={user} />
    </div>
  );
}
