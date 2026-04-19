import { ShieldCheck, AlertTriangle, ShieldX } from 'lucide-react';

export function getCoiState(expiryDate) {
  if (!expiryDate) return { state: 'missing', daysLeft: null };
  const exp = new Date(expiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { state: 'expired', daysLeft };
  if (daysLeft <= 30) return { state: 'expiring', daysLeft };
  return { state: 'valid', daysLeft };
}

export default function COIBadge({ expiryDate }) {
  const { state, daysLeft } = getCoiState(expiryDate);
  if (state === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-gray-100 text-gray-600 border-gray-200">
        No COI
      </span>
    );
  }
  if (state === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-100 text-red-800 border-red-300">
        <ShieldX className="w-3.5 h-3.5" /> Expired
      </span>
    );
  }
  if (state === 'expiring') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-800 border-amber-200">
        <AlertTriangle className="w-3.5 h-3.5" /> Expires in {daysLeft}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-green-50 text-green-700 border-green-200">
      <ShieldCheck className="w-3.5 h-3.5" /> Valid ({daysLeft}d)
    </span>
  );
}
