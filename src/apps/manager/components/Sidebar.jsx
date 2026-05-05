import { useState } from 'react';
import { Sun, HardHat, ShoppingCart, Calendar, Package, Bell, LogOut, GitBranch, MessageCircle } from 'lucide-react';
import Logo from './Logo';
import NotificationsBell from '../../../shared/components/NotificationsBell';
import UserProfileModal from '../../../shared/components/UserProfileModal';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';

// Punch List is per-job (reached from inside a job, not the sidebar).
// The personal scratchpad "My Punch List" lives on the Today screen.
const NAV = [
  { id: 'today',         label: 'Today',         icon: Sun },
  { id: 'dashboard',     label: 'Jobs',          icon: HardHat },
  { id: 'pipeline',      label: 'Pipeline',      icon: GitBranch },
  { id: 'materials-run', label: 'Materials Run', icon: ShoppingCart },
  { id: 'calendar',      label: 'Calendar',      icon: Calendar },
  { id: 'warehouse',     label: 'Warehouse',     icon: Package },
  { id: 'notifications', label: 'Alerts',        icon: Bell },
  { id: 'daily-logs',    label: 'Daily Logs',    icon: MessageCircle },
];

/**
 * Manager sidebar. Same visual language as Owner/Operations/Admin.
 * Collapses to a bottom bar on small screens so Gabriel can still
 * thumb through it from the van — that's handled in CSS via Tailwind.
 */
export default function Sidebar({ screen, onNavigate, onLogout, userName, user }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { photoUrl, refresh } = useUserProfile(user);

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-omega-charcoal flex-col min-h-screen">
        <div className="px-5 py-6 border-b border-white/10">
          <Logo size="sm" />
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
              <p className="text-[10px] text-omega-stone uppercase tracking-widest font-semibold">Manager</p>
              <p className="text-sm font-semibold text-white truncate">{userName || '—'}</p>
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


        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                screen === id ||
                (id === 'dashboard' && screen === 'phase-board')
                  ? 'bg-omega-orange text-white'
                  : 'text-omega-fog hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
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

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-30 overflow-x-auto scrollbar-hide">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = screen === id || (id === 'dashboard' && screen === 'phase-board');
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`flex-1 min-w-[64px] flex flex-col items-center gap-0.5 py-2 transition-colors ${
                active ? 'text-omega-orange' : 'text-omega-stone hover:text-omega-charcoal'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
