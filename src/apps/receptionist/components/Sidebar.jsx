import { useState } from 'react';
import { Calendar, UserPlus, List, LogOut, GitBranch, DollarSign } from 'lucide-react';
import Logo from './Logo';
import UserProfileModal from '../../../shared/components/UserProfileModal';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';
import DailyLogsCascade from '../../../shared/components/DailyLogsCascade';

const NAV = [
  { id: 'calendar',  label: 'Calendar',  icon: Calendar  },
  { id: 'pipeline',  label: 'Pipeline',  icon: GitBranch },
  { id: 'new-lead',  label: 'New Lead',  icon: UserPlus  },
  { id: 'leads',     label: 'My Leads',  icon: List      },
  { id: 'commissions', label: 'Commissions', icon: DollarSign },
];

/**
 * Sidebar for the Receptionist role — same visual language as Owner /
 * Operations / Admin / Manager but scoped to Rafaela's three workflows.
 * Calendar is intentionally on top: that's the default screen she lands
 * on after login so she can see the day before taking the next call.
 */
export default function Sidebar({ screen, onNavigate, onLogout, userName, user, onOpenJob }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { photoUrl, refresh } = useUserProfile(user);

  return (
    <aside className="w-56 flex-shrink-0 bg-omega-charcoal flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <Logo size="sm" />
      </div>

      <button
        onClick={() => setProfileOpen(true)}
        className="px-5 py-4 border-b border-white/10 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer w-full"
        title="Open my profile"
      >
        <Avatar
          name={userName || ''}
          photoUrl={photoUrl || undefined}
          size="sm"
          color={colorFromName(userName || '')}
        />
        <div className="min-w-0">
          <p className="text-[10px] text-omega-stone uppercase tracking-widest font-semibold">Reception</p>
          <p className="text-sm font-semibold text-white truncate">{userName || '—'}</p>
        </div>
      </button>

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
          </button>
        ))}
      </nav>

      <DailyLogsCascade user={user} onOpenJob={onOpenJob} />

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
