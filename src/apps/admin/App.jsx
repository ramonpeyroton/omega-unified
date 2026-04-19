import { useState } from 'react';
import Sidebar from './components/Sidebar';
import UsersAccess from './screens/UsersAccess';
import PricingBook from './screens/PricingBook';
import CompanySettings from './screens/CompanySettings';
import AuditLog from './screens/AuditLog';
import MessageTemplates from './screens/MessageTemplates';
import JarvisChat from '../../shared/components/JarvisChat';

export default function App({ user, onLogout }) {
  const [screen, setScreen] = useState('users');

  const navigate = (s) => setScreen(s);

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
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderScreen()}
      </main>
      <JarvisChat user={user} />
    </div>
  );
}
