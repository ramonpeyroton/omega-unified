// SalesSidebar — persistent left rail rendered by every Sales screen.
// Extracted from Home.jsx so the same sidebar can wrap the whole app
// (Pipeline, Estimates, Notifications, etc) instead of only showing
// on the dashboard. Ramon's rule: sidebar visible on every screen.

import { useState } from 'react';
import {
  Home as HomeIcon, GitBranch, Calendar as CalendarIcon, FileText,
  ClipboardList, DollarSign, MessageCircle, ChevronDown, ChevronRight,
  LogOut,
} from 'lucide-react';
import Logo from './Logo';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';
import UserProfileModal from '../../../shared/components/UserProfileModal';
import DailyLogsList from '../../../shared/components/DailyLogsList';

const NAV_ITEMS = [
  { id: 'home',          label: 'Home',          icon: HomeIcon },
  { id: 'pipeline',      label: 'Pipeline',      icon: GitBranch },
  { id: 'leads',         label: 'My Leads',      icon: ClipboardList },
  { id: 'commissions',   label: 'Commissions',   icon: DollarSign },
  { id: 'estimates',     label: 'Estimates',     icon: FileText },
  { id: 'calendar',      label: 'Calendar',      icon: CalendarIcon },
  { id: 'previous-jobs', label: 'Previous Jobs', icon: ClipboardList },
];

export default function SalesSidebar({ activeId, onNavigate, user, onLogout, onOpenJob }) {
  const [dailyLogsOpen, setDailyLogsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { photoUrl, refresh } = useUserProfile(user);
  const userName = user?.name || '';

  return (
    <aside className="hidden sm:flex w-56 flex-shrink-0 bg-omega-charcoal flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <Logo size="sm" dark />
      </div>

      <button
        onClick={() => setProfileOpen(true)}
        className="px-5 py-4 border-b border-white/10 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer w-full"
        title="Open my profile"
      >
        <Avatar
          name={userName}
          photoUrl={photoUrl || undefined}
          size="sm"
          color={colorFromName(userName)}
        />
        <div className="min-w-0">
          <p className="text-[10px] text-omega-stone uppercase tracking-widest font-semibold">Salesman</p>
          <p className="text-sm font-semibold text-white truncate">{userName || '—'}</p>
        </div>
      </button>

      <UserProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onUserUpdated={refresh}
      />

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeId === id
                ? 'bg-omega-orange text-white'
                : 'text-omega-fog hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </button>
        ))}

        <button
          onClick={() => setDailyLogsOpen((o) => !o)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
            dailyLogsOpen
              ? 'bg-white/10 text-white'
              : 'text-omega-fog hover:bg-white/10 hover:text-white'
          }`}
        >
          <MessageCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left">Daily Logs</span>
          {dailyLogsOpen
            ? <ChevronDown className="w-4 h-4 text-white/60" />
            : <ChevronRight className="w-4 h-4 text-white/60" />}
        </button>
        {dailyLogsOpen && <DailyLogsList user={user} onOpenJob={onOpenJob} />}
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
