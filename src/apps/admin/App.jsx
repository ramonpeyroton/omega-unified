import { useState } from 'react';
import Sidebar from './components/Sidebar';
import UsersAccess from './screens/UsersAccess';
import PricingBook from './screens/PricingBook';
import CompanySettings from './screens/CompanySettings';
import AuditLog from './screens/AuditLog';
import MessageTemplates from './screens/MessageTemplates';
import ScreenOverride from './screens/ScreenOverride';
import JarvisChat from '../../shared/components/JarvisChat';
import CalendarScreen from '../../shared/components/Calendar/CalendarScreen';
import FinanceScreen from '../../shared/components/Finance/FinanceScreen';
import LeadsList from '../receptionist/screens/LeadsList';
import CommissionsScreen from '../../shared/components/CommissionsScreen';
import ImportLeads from './screens/ImportLeads';
import MarketingSpend from './screens/MarketingSpend';
import JobFullView from '../../shared/components/JobFullView';
import { useBackNavHome } from '../../shared/lib/backNav';

export default function App({ user, onLogout }) {
  const [screen, setScreen] = useState('users');
  const [fullViewJob, setFullViewJob] = useState(null);
  const [fullViewInitialTab, setFullViewInitialTab] = useState(null);

  const navigate = (s) => setScreen(s);

  useBackNavHome(() => {
    if (screen !== 'users') setScreen('users');
  });

  const handleLogout = () => {
    setScreen('users');
    onLogout();
  };

  const renderScreen = () => {
    switch (screen) {
      case 'users':     return <UsersAccess user={user} />;
      case 'pricing':   return <PricingBook user={user} />;
      case 'company':   return <CompanySettings user={user} />;
      case 'audit':     return <AuditLog />;
      case 'templates': return <MessageTemplates user={user} />;
      case 'calendar':  return <CalendarScreen user={user} />;
      case 'finance':   return <FinanceScreen user={user} />;
      case 'leads':     return <LeadsList user={user} onBack={() => setScreen('users')} />;
      case 'commissions': return <CommissionsScreen user={user} />;
      case 'import-leads': return <ImportLeads user={user} />;
      case 'marketing-spend': return <MarketingSpend user={user} />;
      case 'screen':    return <ScreenOverride user={user} />;
      default:          return <UsersAccess user={user} />;
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
        onOpenJob={(job) => { setFullViewJob(job); setFullViewInitialTab('daily'); }}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderScreen()}
      </main>
      {fullViewJob && (
        <JobFullView
          job={fullViewJob}
          user={user}
          initialTab={fullViewInitialTab}
          onClose={() => { setFullViewJob(null); setFullViewInitialTab(null); }}
          onJobUpdated={(u) => setFullViewJob(u)}
          onJobDeleted={() => { setFullViewJob(null); setFullViewInitialTab(null); }}
        />
      )}
      <JarvisChat user={user} />
    </div>
  );
}
