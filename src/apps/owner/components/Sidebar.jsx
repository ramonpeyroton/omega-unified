import { useState } from 'react';
import { LayoutDashboard, Users, Bell, LogOut, FileSearch, Package, Brain, GitBranch, Calendar, DollarSign, ClipboardList, MessageCircle } from 'lucide-react';
import Logo from './Logo';
import NotificationsBell from '../../../shared/components/NotificationsBell';
import UserProfileModal from '../../../shared/components/UserProfileModal';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';

const NAV = [
  { id: 'dashboard',        label: 'Dashboard',        icon: LayoutDashboard },
  { id: 'pipeline',         label: 'Pipeline',          icon: GitBranch },
  { id: 'leads',            label: 'My Leads',          icon: ClipboardList },
  { id: 'calendar',         label: 'Calendar',          icon: Calendar },
  { id: 'finance',          label: 'Finance',           icon: DollarSign },
  { id: 'commissions',      label: 'Commissions',       icon: DollarSign },
  { id: 'project-analyzer', label: 'Project Analyzer', icon: FileSearch },
  { id: 'warehouse',        label: 'Warehouse',         icon: Package },
  { id: 'omega-brain',      label: 'Omega Brain',       icon: Brain },
  { id: 'subcontractors',   label: 'Subcontractors',    icon: Users },
  { id: 'notifications',    label: 'Notifications',     icon: Bell },
  { id: 'daily-logs',       label: 'Daily Logs',        icon: MessageCircle },
];

export default function Sidebar({ screen, onNavigate, onLogout, notifCount, userName, user }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { photoUrl, refresh } = useUserProfile(user);

  return (
    <aside className="w-56 flex-shrink-0 bg-omega-charcoal flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <Logo size="sm" dark horizontal />
      </div>

      <div className="px-3 py-4 border-b border-white/10 flex items-center justify-between gap-2">
        <button
          onClick={() => setProfileOpen(true)}
          className="flex items-center gap-2.5 min-w-0 text-left rounded-lg px-2 py-1 -mx-2 -my-1 hover:bg-white/5 transition cursor-pointer"
          title="Open my profile"
        >
          <Avatar
            name={userName || ''}
            photoUrl={photoUrl || undefined}
            size="sm"
            color={colorFromName(userName || '')}
          />
          <div className="min-w-0">
            <p className="text-[10px] text-omega-stone uppercase tracking-widest font-semibold">Owner</p>
            <p className="text-sm font-semibold text-white truncate">{userName}</p>
          </div>
        </button>
        <NotificationsBell user={user} dark />
      </div>

      <UserProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onUserUpdated={refresh}
      />


      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              screen === id
                ? 'bg-omega-orange text-white'
                : 'text-omega-fog hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
            {id === 'notifications' && notifCount > 0 && (
              <span className="ml-auto w-5 h-5 text-[10px] font-bold rounded-full bg-omega-orange text-white flex items-center justify-center">
                {notifCount > 9 ? '9+' : notifCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-omega-fog hover:bg-white/10 hover:text-white transition-all"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
