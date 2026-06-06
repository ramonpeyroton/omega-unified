// MobileMoreSheet — the "More" (•••) overflow menu for the Manager mobile
// bottom bar. The bar keeps Today / Jobs / Receipts / Logs; everything else
// Gabriel reaches (Pipeline, Materials, Calendar, Warehouse, Alerts) lives
// here, plus Profile + Sign Out. Same pattern as the Owner sheet.

import { useState } from 'react';
import {
  X, GitBranch, ShoppingCart, Calendar, Package, LogOut,
} from 'lucide-react';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';
import UserProfileModal from '../../../shared/components/UserProfileModal';

const ITEMS = [
  { id: 'pipeline',      label: 'Pipeline',  icon: GitBranch },
  { id: 'materials-run', label: 'Materials', icon: ShoppingCart },
  { id: 'calendar',      label: 'Calendar',  icon: Calendar },
  { id: 'warehouse',     label: 'Warehouse', icon: Package },
];

export default function MobileMoreSheet({ open, onClose, onNavigate, user, onLogout }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { photoUrl, refresh } = useUserProfile(user);
  const userName = user?.name || '';

  if (!open) return null;

  const go = (id) => { onNavigate(id); onClose(); };

  return (
    <>
      <div className="md:hidden fixed inset-0 z-50 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl shadow-2xl pb-[env(safe-area-inset-bottom)] animate-[slideUp_0.2s_ease-out]">
        <div className="relative pt-3 pb-1">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300" />
          <button onClick={onClose} aria-label="Close menu" className="absolute right-4 top-2 p-2 text-omega-stone hover:text-omega-charcoal">
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={() => setProfileOpen(true)}
          className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <Avatar name={userName} photoUrl={photoUrl || undefined} size="md" color={colorFromName(userName)} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-omega-charcoal truncate">{userName || '—'}</p>
            <p className="text-[11px] text-omega-stone">View my profile</p>
          </div>
        </button>

        <div className="h-px bg-gray-100 mx-5" />

        <nav className="px-3 py-2">
          {ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-omega-charcoal hover:bg-omega-cloud transition-colors"
            >
              <span className="w-9 h-9 rounded-xl bg-omega-pale text-omega-orange flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </nav>

        <div className="h-px bg-gray-100 mx-5" />

        <div className="px-3 py-2">
          <button
            onClick={() => { onClose(); onLogout?.(); }}
            className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-red-600 hover:bg-red-50 transition-colors"
          >
            <span className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <LogOut className="w-4 h-4" />
            </span>
            <span className="text-sm font-semibold">Sign Out</span>
          </button>
        </div>
      </div>

      <UserProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} user={user} onUserUpdated={refresh} />

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
