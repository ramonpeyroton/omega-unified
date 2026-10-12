import { ShieldCheck, AlertTriangle, ShieldX, FileX } from 'lucide-react';

// COI = one certificate with two policies that expire on their own dates:
// Workers Comp (subcontractors.workers_comp_expiry) and General Liability
// (general_liability_expiry). The badge shows one chip per policy — but only
// when the certificate file is on the sub (coi_url). A date with no file
// isn't proof of insurance, so it never shows as valid (Ramon, 12/10/26).
//
// coi_expiry_date is a legacy single date typed by an old Add Sub form; it
// only counts as "there was something" for the No COI file state.

const EXPIRING_DAYS = 30;

// 'YYYY-MM-DD' read as a local calendar day (not UTC midnight, which made
// the count one day short in New York).
function localDay(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function getCoiState(expiryDate) {
  const exp = localDay(expiryDate);
  if (!exp) return { state: 'missing', daysLeft: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((exp - today) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { state: 'expired', daysLeft };
  if (daysLeft <= EXPIRING_DAYS) return { state: 'expiring', daysLeft };
  return { state: 'valid', daysLeft };
}

export const hasCoiFile = (sub) => !!sub?.coi_url;

// Whole-sub state for counts/filters:
// 'missing' | 'no_file' | 'no_dates' | 'expired' | 'expiring' | 'valid'
// (with a file, the worst of the two policies wins).
export function getSubCoiState(sub) {
  const dates = [sub?.workers_comp_expiry, sub?.general_liability_expiry];
  if (!hasCoiFile(sub)) {
    return (dates.some(Boolean) || sub?.coi_expiry_date) ? 'no_file' : 'missing';
  }
  const states = dates.filter(Boolean).map((d) => getCoiState(d).state);
  if (!states.length) return 'no_dates';
  for (const s of ['expired', 'expiring']) if (states.includes(s)) return s;
  return 'valid';
}

const CHIP = 'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap';

function PolicyChip({ label, date }) {
  const { state, daysLeft } = getCoiState(date);
  if (state === 'missing') {
    return <span className={`${CHIP} bg-gray-100 text-gray-600 border-gray-200`}>{label} · no date</span>;
  }
  if (state === 'expired') {
    return <span className={`${CHIP} bg-red-100 text-red-800 border-red-300`}><ShieldX className="w-3.5 h-3.5" /> {label} expired</span>;
  }
  if (state === 'expiring') {
    return <span className={`${CHIP} bg-amber-50 text-amber-800 border-amber-200`}><AlertTriangle className="w-3.5 h-3.5" /> {label} expires in {daysLeft}d</span>;
  }
  return <span className={`${CHIP} bg-green-50 text-green-700 border-green-200`}><ShieldCheck className="w-3.5 h-3.5" /> {label} valid {daysLeft}d</span>;
}

export default function COIBadge({ sub }) {
  const state = getSubCoiState(sub);
  if (state === 'missing') {
    return <span className={`${CHIP} bg-gray-100 text-gray-600 border-gray-200`}>No COI</span>;
  }
  if (state === 'no_file') {
    return <span className={`${CHIP} bg-gray-100 text-gray-600 border-gray-200`}><FileX className="w-3.5 h-3.5" /> No COI file</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <PolicyChip label="WC" date={sub.workers_comp_expiry} />
      <PolicyChip label="GL" date={sub.general_liability_expiry} />
    </span>
  );
}
