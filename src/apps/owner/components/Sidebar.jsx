import { LayoutDashboard, Users, Bell, LogOut, FileSearch, Package, Brain, GitBranch } from 'lucide-react';
import Logo from './Logo';
import NotificationsBell from '../../../shared/components/NotificationsBell';

const NAV = [
  { id: 'dashboard',        label: 'Dashboard',        icon: LayoutDashboard },
  { id: 'pipeline',         label: 'Pipeline',          icon: GitBranch },
  { id: 'project-analyzer', label: 'Project Analyzer', icon: FileSearch },
  { id: 'warehouse',        label: 'Warehouse',         icon: Package },
  { id: 'omega-brain',      label: 'Omega Brain',       icon: Brain },
  { id: 'subcontractors',   label: 'Subcontractors',    icon: Users },
  { id: 'notifications',    label: 'Notifications',     icon: Bell },
];

export default function Sidebar({ screen, onNavigate, onLogout, notifCount, userName, user }) {
  return (
    <aside className="w-56 flex-shrink-0 bg-omega-charcoal flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <Logo size="sm" dark horizontal />
      </div>

      <div className="px-3 py-4 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-omega-stone uppercase tracking-widest font-semibold px-2 mb-1">Owner</p>
          <p className="text-sm font-semibold text-white px-2 truncate">{userName}</p>
        </div>
        <NotificationsBell user={user} dark />
      </div>

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
