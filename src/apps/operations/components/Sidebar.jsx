import { LayoutDashboard, FileText, FilePen, Users, GitBranch, LogOut } from 'lucide-react';
import Logo from './Logo';
import NotificationsBell from '../../../shared/components/NotificationsBell';

const NAV = [
  { id: 'dashboard',       label: 'Dashboard',       icon: LayoutDashboard },
  { id: 'pipeline',        label: 'Project Pipeline', icon: GitBranch },
  { id: 'contracts',       label: 'Contracts',        icon: FileText },
  { id: 'subcontractors',  label: 'Subcontractors',   icon: Users },
];

export default function Sidebar({ screen, onNavigate, onLogout, userName, user }) {
  return (
    <aside className="w-56 flex-shrink-0 bg-omega-charcoal flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <Logo size="sm" />
      </div>

      <div className="px-3 py-4 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-omega-stone uppercase tracking-widest font-semibold px-2 mb-1">Operations</p>
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
              screen === id || (id === 'dashboard' && screen === 'estimate-flow')
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
  );
}
