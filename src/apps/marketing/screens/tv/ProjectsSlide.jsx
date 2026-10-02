// TV slide 3 — Projects. The money life of every job in execution
// (pipeline_status = 'in_progress'): signed contract value vs what is
// already committed — subcontractor agreements (agreed total, with what was
// paid) + Office purchases (Material / Fuel / Van / Return) + any other
// job_expenses category on its own line. Ghost payments are left out on
// purpose. Read-only: nothing here writes to the database.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  HardHat, FileSignature, Wallet, TrendingUp, TrendingDown, FileX,
} from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { serviceBadgeLabel } from '../../../../shared/data/services';
import {
  T, CARD, TONE, CHIP_TONE, ORANGE, usd, usdShort, plural, selectIn, toMs,
  SectionTitle, CountUp, SlideLoading, EmptyState,
} from './tvKit';

export const meta = {
  key: 'projects',
  title: 'Projects',
  eyebrow: 'Jobs in progress · cost vs contract',
  icon: HardHat,
  tables: ['jobs', 'contracts', 'subcontractor_agreements', 'sub_payments', 'job_expenses'],
};

// job_expenses categories that roll up into the single "Office" line.
const OFFICE_CATEGORIES = new Set(['Material', 'Fuel', 'Van', 'Return']);

// Bar / dot color per kind of cost line.
const KIND = {
  sub:     { hex: '#6366F1' },
  office:  { hex: ORANGE },
  expense: { hex: '#64748B' },
};

const OVER_HEX = '#9F1239'; // second lap of the gauge when a job is past 100%
const NONE_HEX = '#B8B6B0';

// Same sizes as the kit ramp (T.title / T.label / T.eyebrow), heavier weight
// for numbers that sit in tight cards.
const NUM_SM = 'font-black tabular-nums leading-tight tracking-tight text-[clamp(18px,2.6vh,28px)]';
const SMALL = 'text-[clamp(11px,1.5vh,16px)]';

// Grid cards (7+ jobs) are CSS size containers: everything inside is sized in
// cqmin (1% of the card's shorter side), so the content grows with the card —
// a roomy 1080p TV card reads from across the room instead of looking empty.
const CQ = {
  name:    'font-black leading-[1.1] tracking-tight text-[clamp(14px,8cqmin,72px)]',
  chip:    'text-[clamp(11px,4.4cqmin,34px)]',
  pct:     'font-black tabular-nums leading-none text-[clamp(12px,8.4cqmin,64px)]',
  cap:     'text-[clamp(9px,3.4cqmin,26px)]',
  eyebrow: 'font-bold uppercase tracking-wider text-omega-stone leading-tight text-[clamp(10px,4.1cqmin,30px)]',
  key:     'font-black tabular-nums leading-[1.05] tracking-tight text-[clamp(18px,12.5cqmin,96px)]',
  text:    'text-[clamp(11px,5cqmin,36px)]',
  total:   'text-[clamp(12px,6cqmin,44px)]',
  small:   'text-[clamp(10px,3.8cqmin,28px)]',
  bar:     'h-[clamp(6px,2.4cqmin,18px)]',
};

const EASE = [0.22, 1, 0.36, 1];

// Full dollars in the roomy cards, short form from $1M up.
function usdFit(n) {
  return Math.abs(Number(n)) >= 1_000_000 ? usdShort(n) : usd(n);
}

// usdShort without the decimal from $10k up ($26.4k → $26k), so a cost line
// still fits label + amount + paid in the narrow compact cards.
function usdTight(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 10_000 || Math.abs(v) >= 1_000_000) return usdShort(n);
  return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v) / 1000)}k`;
}

// ─── Data ────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Payment-plan item → dollars (same rule as milestoneAmount in finance.js).
function planAmount(item, total) {
  if (!item) return 0;
  if (item.amount != null && item.amount !== '') return num(item.amount);
  if (item.percent != null && total) return (num(total) * num(item.percent)) / 100;
  return 0;
}

// Several signed contracts on one job: a re-signed contract for the same
// estimate(s) replaces the earlier one (keep the latest signature), while
// contracts for different estimates are separate scopes and add up.
function contractValue(contracts) {
  const latestByScope = {};
  for (const c of contracts) {
    const ids = Array.isArray(c.estimate_ids) && c.estimate_ids.length
      ? [...c.estimate_ids].map(String).sort().join(',')
      : null;
    const scope = ids || (c.estimate_id ? String(c.estimate_id) : `contract:${c.id}`);
    const prev = latestByScope[scope];
    if (!prev || (toMs(c.signed_at) ?? 0) > (toMs(prev.signed_at) ?? 0)) latestByScope[scope] = c;
  }
  const kept = Object.values(latestByScope);
  const total = kept.reduce((s, c) => s + num(c.total_amount), 0);
  return { value: total > 0 ? total : null, signed: kept.length };
}

// "12 Main St, Norwalk, CT 06850, USA" / "12 Main St, Norwalk - CT" → "Norwalk".
function cityFromAddress(address) {
  if (!address) return '';
  const parts = String(address).split(',').map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1 && /^(usa|us|united states)$/i.test(parts[parts.length - 1])) parts.pop();
  while (parts.length > 1 && /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2) return '';
  const city = parts[parts.length - 1].replace(/\s*-\s*[A-Z]{2}(\s+\d{5})?$/, '').trim();
  return /\d/.test(city) ? '' : city;
}

function serviceLabel(value) {
  return serviceBadgeLabel(value)
    .split(', ')
    .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(', ');
}

// Signed agreements for these jobs. An agreement may carry job_id /
// subcontractor_id / their_estimate itself or inherit them from the offer it
// came from (offer.agreement_id → agreement, or agreement.offer_id → offer).
async function loadAgreements(jobIds) {
  const signed = (q) => q.not('signed_at', 'is', null);
  const withJob = await selectIn('subcontractor_agreements', '*', 'job_id', jobIds, signed);
  const { data: orphans, error } = await signed(
    supabase.from('subcontractor_agreements').select('*').is('job_id', null),
  );
  if (error) throw error;
  const agreements = [...withJob, ...(orphans || [])];
  if (!agreements.length) return [];

  const OFFER_COLS = 'id, agreement_id, payment_plan, their_estimate, subcontractor_id, job_id';
  let offers = [];
  try {
    offers = await selectIn('subcontractor_offers', OFFER_COLS, 'agreement_id', agreements.map((a) => a.id));
    const offerIds = agreements.map((a) => a.offer_id).filter(Boolean);
    if (offerIds.length) offers.push(...await selectIn('subcontractor_offers', OFFER_COLS, 'id', offerIds));
  } catch { /* agreements still count with their own fields */ }
  const offerById = Object.fromEntries(offers.map((o) => [o.id, o]));
  const offerByAgreement = Object.fromEntries(offers.filter((o) => o.agreement_id).map((o) => [o.agreement_id, o]));

  const wanted = new Set(jobIds);
  return agreements
    .map((a) => {
      const offer = (a.offer_id && offerById[a.offer_id]) || offerByAgreement[a.id] || null;
      return {
        id: a.id,
        voided: ['declined', 'cancelled', 'canceled', 'voided'].includes(String(a.status || '').toLowerCase()),
        job_id: a.job_id || offer?.job_id || null,
        subcontractor_id: a.subcontractor_id || offer?.subcontractor_id || null,
        estimate: num(a.their_estimate) || num(offer?.their_estimate) || num(a.total_amount),
        plan: Array.isArray(a.payment_plan) && a.payment_plan.length ? a.payment_plan
          : Array.isArray(offer?.payment_plan) ? offer.payment_plan : [],
      };
    })
    .filter((a) => a.job_id && wanted.has(a.job_id));
}

export async function load(now = Date.now()) {
  const { data: jobRows, error } = await supabase
    .from('jobs')
    .select('id, client_name, service, city, address, cover_photo_url')
    .eq('pipeline_status', 'in_progress');
  if (error) throw error;
  const jobs = jobRows || [];
  if (!jobs.length) return { jobs: [], loadedAt: now };
  const ids = jobs.map((j) => j.id);

  const [contracts, agreements, expenses] = await Promise.all([
    selectIn('contracts', 'id, job_id, estimate_id, estimate_ids, total_amount, signed_at', 'job_id', ids,
      (q) => q.not('signed_at', 'is', null)),
    loadAgreements(ids),
    selectIn('job_expenses', 'job_id, category, amount', 'job_id', ids),
  ]);

  const payments = agreements.length
    ? await selectIn('sub_payments', 'agreement_id, due_amount, paid_amount', 'agreement_id', agreements.map((a) => a.id))
    : [];

  let subsById = {};
  const subIds = [...new Set(agreements.map((a) => a.subcontractor_id).filter(Boolean))];
  if (subIds.length) {
    try {
      const subs = await selectIn('subcontractors', 'id, name, trade', 'id', subIds);
      subsById = Object.fromEntries(subs.map((s) => [s.id, s]));
    } catch { /* lines fall back to "Subcontractor" */ }
  }

  const paysByAgreement = {};
  payments.forEach((p) => { (paysByAgreement[p.agreement_id] ||= []).push(p); });

  return {
    loadedAt: now,
    jobs: jobs.map((job) => {
      const contract = contractValue(contracts.filter((c) => c.job_id === job.id));
      const lines = [];

      // One line per subcontractor (several agreements on the job merge).
      const bySub = {};
      agreements.filter((a) => a.job_id === job.id).forEach((a) => {
        const ps = paysByAgreement[a.id] || [];
        const due = ps.reduce((s, p) => s + num(p.due_amount), 0);
        const agreed = a.estimate || due || a.plan.reduce((s, p) => s + planAmount(p, 0), 0);
        // Plans not materialized into sub_payments yet: count items flagged paid.
        const paid = ps.length
          ? ps.reduce((s, p) => s + num(p.paid_amount), 0)
          : a.plan.filter((p) => p?.paid).reduce((s, p) => s + planAmount(p, agreed), 0);
        // A cancelled/declined agreement only costs what was already paid.
        if (a.voided && !paid) return;
        const committed = a.voided ? paid : agreed;
        const key = a.subcontractor_id || `agreement:${a.id}`;
        const sub = subsById[a.subcontractor_id] || {};
        const line = (bySub[key] ||= {
          key: `sub:${key}`,
          kind: 'sub',
          label: (sub.trade || '').trim() || (sub.name || '').trim() || 'Subcontractor',
          secondary: (sub.trade || '').trim() ? (sub.name || '').trim() : '',
          amount: 0,
          paid: 0,
        });
        line.amount += committed;
        line.paid += paid;
      });
      lines.push(...Object.values(bySub));

      // Office + every other expense category on its own line.
      const byCategory = {};
      expenses.filter((e) => e.job_id === job.id).forEach((e) => {
        const cat = (e.category || '').trim() || 'Other';
        const key = OFFICE_CATEGORIES.has(cat) ? 'Office' : cat;
        byCategory[key] = (byCategory[key] || 0) + num(e.amount);
      });
      Object.entries(byCategory).forEach(([label, amount]) => {
        lines.push({ key: `exp:${label}`, kind: label === 'Office' ? 'office' : 'expense', label, amount, paid: null });
      });

      lines.sort((a, b) => b.amount - a.amount);
      const spent = lines.reduce((s, l) => s + l.amount, 0);
      const pct = contract.value ? spent / contract.value : null;
      return {
        id: job.id,
        name: (job.client_name || '').trim() || 'Unnamed job',
        service: serviceLabel(job.service),
        city: (job.city || '').trim() || cityFromAddress(job.address),
        photo: job.cover_photo_url || null,
        contract: contract.value,
        signedContracts: contract.signed,
        lines,
        spent,
        pct,
        margin: contract.value != null ? contract.value - spent : null,
      };
    }),
  };
}

// ─── View model ──────────────────────────────────────────────────────

// Judged on the rounded % the gauge shows, so a ring reading "70%" is never
// green and "90%" is never amber.
function toneFor(pct) {
  if (pct == null) return null;
  const shown = Math.round(pct * 100);
  if (shown >= 90) return 'bad';
  if (shown >= 70) return 'warn';
  return 'good';
}

// Margin as a share of contract value → same thresholds as the gauge
// (≥30% margin = under 70% spent).
function marginTone(ratio) {
  if (ratio == null) return undefined;
  if (ratio <= 0.1) return 'bad';
  if (ratio <= 0.3) return 'warn';
  return 'good';
}

// How the cards tile the screen for a given job count.
function gridFor(n) {
  if (n <= 3) return { rows: 1, cols: n, variant: 'wide', capacity: n };
  if (n <= 6) return { rows: 1, cols: n, variant: 'tall', capacity: n };
  if (n <= 12) return { rows: 2, cols: Math.ceil(n / 2), variant: 'grid', capacity: n };
  const cols = Math.min(6, Math.ceil(n / 3));
  return { rows: 3, cols, variant: 'grid', capacity: cols * 3 };
}

function buildView(data) {
  const jobs = (data?.jobs || []).map((j) => ({ ...j, tone: toneFor(j.pct) }));
  // Riskiest first: over budget → highest % spent; jobs without a contract
  // last, biggest spend first.
  jobs.sort((a, b) => {
    if (a.pct == null || b.pct == null) return a.pct == null && b.pct == null ? b.spent - a.spent : a.pct == null ? 1 : -1;
    return b.pct - a.pct;
  });

  const contracted = jobs.filter((j) => j.contract != null);
  const contractTotal = contracted.reduce((s, j) => s + j.contract, 0);
  const contractedSpent = contracted.reduce((s, j) => s + j.spent, 0);
  const sumKind = (kind) => jobs.reduce((s, j) => s + j.lines.filter((l) => l.kind === kind).reduce((a, l) => a + l.amount, 0), 0);
  const margin = contracted.length ? contractTotal - contractedSpent : null;
  const marginRatio = contractTotal ? margin / contractTotal : null;
  const costWithoutContract = jobs.filter((j) => j.contract == null).reduce((s, j) => s + j.spent, 0);

  return {
    jobs,
    totals: {
      count: jobs.length,
      over: jobs.filter((j) => j.pct != null && j.pct > 1).length,
      atRisk: jobs.filter((j) => j.tone === 'bad').length,
      noContract: jobs.length - contracted.length,
      contracted: contracted.length,
      contractTotal,
      cost: jobs.reduce((s, j) => s + j.spent, 0),
      subs: sumKind('sub'),
      office: sumKind('office'),
      other: sumKind('expense'),
      costWithoutContract,
      margin,
      marginRatio,
    },
  };
}

// ─── Pieces ──────────────────────────────────────────────────────────

// Like the kit's useFitChildren (hide what doesn't fit whole) but also
// reports how many lines were hidden, for the "+N more" label.
function useFitCount(deps) {
  const ref = useRef(null);
  const [hidden, setHidden] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const fit = () => {
      const limit = box.clientHeight + 1;
      let h = 0;
      for (const el of box.children) {
        const ok = el.offsetTop + el.offsetHeight <= limit;
        el.style.visibility = ok ? '' : 'hidden';
        if (!ok) h++;
      }
      setHidden(h);
    };
    fit();
    // Children too: their height changes when the web font finishes loading.
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    for (const el of box.children) ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, hidden];
}

// Radial gauge: % of the contract already committed. Past 100% the ring is
// full red and a darker second lap shows how far over it went.
function Gauge({ job, size, numClass, capClass, delay, reduce }) {
  const R = 50;
  const SW = 13;
  const hex = job.tone ? TONE[job.tone].hex : NONE_HEX;
  const main = Math.max(0, Math.min(job.pct ?? 0, 1));
  const over = Math.max(0, Math.min((job.pct ?? 0) - 1, 1));
  const arc = (value, stroke, extraDelay = 0, duration = 0.75) => (
    <motion.circle
      cx="60" cy="60" r={R} fill="none" stroke={stroke} strokeWidth={SW} strokeLinecap="round"
      initial={reduce ? false : { pathLength: 0 }}
      animate={{ pathLength: value }}
      transition={{ duration, delay: delay + extraDelay, ease: EASE }}
    />
  );

  if (job.pct == null) {
    return (
      <div className="relative flex-shrink-0 aspect-square" style={{ width: size }}>
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth={4} strokeDasharray="3 7" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-omega-fog">
          <FileX className="w-[30%] h-[30%]" strokeWidth={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-shrink-0 aspect-square" style={{ width: size }}>
      {over > 0 && <div className="absolute inset-[10%] rounded-full bg-rose-500/25 blur-xl motion-safe:animate-pulse" />}
      <svg viewBox="0 0 120 120" className="relative w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={SW} />
        {main > 0 && arc(main, hex)}
        {over > 0 && arc(over, OVER_HEX, 0.55, 0.4)}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp
          value={Math.round(job.pct * 100)}
          format={(v) => `${Math.round(v)}%`}
          className={`${numClass} ${TONE[job.tone].text}`}
        />
        {capClass && (
          <span className={`${capClass} font-bold uppercase tracking-wider leading-tight ${over > 0 ? 'text-rose-600' : 'text-omega-stone'}`}>
            spent
          </span>
        )}
      </div>
    </div>
  );
}

// Thin bar under a cost line: committed length, paid part solid on top.
// `thick`: true for the roomy cards, or a height class for the grid cards.
function CostBar({ line, scale, delay, reduce, thick }) {
  const hex = KIND[line.kind].hex;
  const w = (v) => `${Math.max(0, Math.min(1, scale ? v / scale : 0)) * 100}%`;
  const grow = (target, d) => ({
    initial: reduce ? false : { width: 0 },
    animate: { width: target },
    transition: { duration: 0.5, delay: d, ease: EASE },
  });
  return (
    <div className={`relative w-full rounded-full overflow-hidden bg-black/[0.06] ${typeof thick === 'string' ? thick : thick ? 'h-2.5' : 'h-2'}`}>
      {line.paid != null ? (
        <>
          <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: hex, opacity: 0.3 }} {...grow(w(line.amount), delay)} />
          <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: hex }} {...grow(w(line.paid), delay + 0.1)} />
        </>
      ) : (
        <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: hex }} {...grow(w(line.amount), delay)} />
      )}
    </div>
  );
}

// size: 'lg' (wide cards, full dollars + company name), 'md' (tall cards),
// 'cq' (grid cards, sized to the card).
function CostLine({ line, scale, size, delay, reduce }) {
  if (size === 'cq') {
    return (
      <div className="flex-shrink-0">
        <div className="flex items-baseline gap-[2.5cqmin] min-w-0">
          <p className={`flex-1 min-w-0 truncate leading-tight font-semibold text-[#111] ${CQ.text}`}>{line.label}</p>
          <p className={`flex-shrink-0 whitespace-nowrap leading-tight font-black tabular-nums text-[#111] ${CQ.text}`}>{usdShort(line.amount)}</p>
        </div>
        <div className="mt-[1.4cqmin] flex items-center gap-[2.5cqmin] min-w-0">
          <div className="flex-1 min-w-0">
            <CostBar line={line} scale={scale} delay={delay} reduce={reduce} thick={CQ.bar} />
          </div>
          {line.paid != null && (
            <span className={`${CQ.small} flex-shrink-0 whitespace-nowrap leading-tight font-semibold text-omega-stone`}>paid {usdTight(line.paid)}</span>
          )}
        </div>
      </div>
    );
  }

  const money = size === 'lg' ? usd : usdShort;
  const amountClass = 'font-black tabular-nums text-[#111] text-[clamp(14px,2vh,21px)]';

  // Tall cards are narrow: the paid amount moves next to the bar so the
  // trade name keeps the whole first row.
  if (size === 'md') {
    return (
      <div className="flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: KIND[line.kind].hex }} />
          <p className="flex-1 min-w-0 truncate leading-tight font-bold text-[#111] text-[clamp(14px,2vh,21px)]">{line.label}</p>
          <p className={`flex-shrink-0 whitespace-nowrap leading-tight ${amountClass}`}>{money(line.amount)}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <CostBar line={line} scale={scale} delay={delay} reduce={reduce} thick />
          </div>
          {line.paid != null && (
            <span className={`${SMALL} flex-shrink-0 whitespace-nowrap leading-tight font-semibold text-omega-stone`}>paid {money(line.paid)}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0">
      <div className="flex items-center min-w-0 gap-2.5">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: KIND[line.kind].hex }} />
        <p className="flex-1 min-w-0 truncate leading-tight font-medium text-[clamp(14px,2vh,21px)]">
          <span className="font-bold text-[#111]">{line.label}</span>
          {size === 'lg' && line.secondary && <span className="text-omega-stone"> · {line.secondary}</span>}
        </p>
        <p className="flex-shrink-0 whitespace-nowrap leading-tight">
          <span className={amountClass}>{money(line.amount)}</span>
          {line.paid != null && (
            <span className={`${SMALL} font-semibold text-omega-stone`}> · paid {money(line.paid)}</span>
          )}
        </p>
      </div>
      <div className="mt-2">
        <CostBar line={line} scale={scale} delay={delay} reduce={reduce} thick />
      </div>
    </div>
  );
}

// `center`: shrink to the lines and sit in the middle of the column instead
// of filling it from the top (single-job layout).
function CostList({ job, size, delay, reduce, cols = 1, center = false }) {
  const [ref, hidden] = useFitCount([job.lines, size, cols]);
  const scale = job.contract || Math.max(0, ...job.lines.map((l) => l.amount));
  const cq = size === 'cq';
  const eyebrow = cq ? CQ.eyebrow : `${T.eyebrow} leading-tight`;
  return (
    <div className={`${center ? '' : 'flex-1'} min-h-0 flex flex-col`}>
      <div className={`flex items-baseline justify-between gap-3 flex-shrink-0 border-t border-black/[0.06] ${cq ? 'pt-[2.6cqmin] mb-[2.4cqmin]' : 'pt-3 mb-3'}`}>
        <p className={`${eyebrow} truncate`}>
          {job.lines.length
            ? <>Costs <span className={`text-[#111] font-black tabular-nums normal-case ${cq ? CQ.total : ''}`}>{usdShort(job.spent)}</span></>
            : 'No costs logged yet'}
        </p>
        {hidden > 0 && <p className={`${eyebrow} whitespace-nowrap !text-omega-slate`}>+{hidden} more</p>}
      </div>
      {job.lines.length ? (
        <div
          ref={ref}
          className={`relative ${center ? '' : 'flex-1'} min-h-0 overflow-hidden ${
            cols > 1 ? 'grid grid-cols-2 content-start gap-x-10 gap-y-3.5' : `flex flex-col ${cq ? 'gap-[2.8cqmin]' : 'gap-3.5'}`
          }`}
        >
          {job.lines.map((line, i) => (
            <CostLine key={line.key} line={line} scale={scale} size={size} delay={delay + 0.25 + Math.min(i, 4) * 0.06} reduce={reduce} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Figure({ label, value, labelClass = '', valueClass, tone }) {
  return (
    <div className="min-w-0">
      <p className={`${T.eyebrow} leading-tight truncate ${labelClass}`}>{label}</p>
      <p className={`${valueClass} whitespace-nowrap ${tone ? TONE[tone].text : 'text-[#111]'}`}>{value}</p>
    </div>
  );
}

function marginLabel(job) {
  if (job.contract == null) return 'Spent';
  return job.pct > 1 ? 'Over budget' : 'Margin left';
}

// Wide / tall cards: contract and margin stacked, each with its own label.
// `grid`: contract + committed side by side, margin full width underneath.
function Figures({ job, valueClass, marginClass, money, showSpent = false, grid = false }) {
  const over = job.pct != null && job.pct > 1;
  return (
    <div className={`min-w-0 ${grid ? 'grid grid-cols-2 gap-x-8 gap-y-[clamp(6px,1.2vh,14px)]' : 'flex flex-col gap-[clamp(6px,1.2vh,14px)]'}`}>
      {job.contract != null
        ? <Figure label="Contract" value={money(job.contract)} valueClass={valueClass} />
        : <Figure label="Contract" value={job.signedContracts ? 'No value' : 'None signed'} valueClass={`${valueClass} !text-omega-fog`} />}
      {showSpent && job.contract != null && <Figure label="Committed" value={money(job.spent)} valueClass={valueClass} />}
      <div className={grid ? 'col-span-2 min-w-0' : 'min-w-0'}>
        <Figure
          label={marginLabel(job)}
          labelClass={over ? '!text-rose-600' : ''}
          value={money(job.contract != null ? job.margin : job.spent)}
          valueClass={marginClass}
          tone={job.contract != null ? job.tone : null}
        />
      </div>
    </div>
  );
}

// Grid cards: margin as the figure, contract as the line under it.
function KeyFigure({ job }) {
  const over = job.pct != null && job.pct > 1;
  const hasContract = job.contract != null;
  return (
    <div className="min-w-0">
      <p className={`${CQ.eyebrow} truncate ${over ? '!text-rose-600' : ''}`}>{marginLabel(job)}</p>
      <p className={`${CQ.key} whitespace-nowrap ${hasContract ? TONE[job.tone].text : 'text-[#111]'}`}>
        {usdShort(hasContract ? job.margin : job.spent)}
      </p>
      <p className={`${CQ.text} font-semibold leading-tight text-omega-stone truncate`}>
        {hasContract
          ? <>Contract <span className="font-black text-[#111] tabular-nums">{usdShort(job.contract)}</span></>
          : job.signedContracts ? 'contract $0' : 'no contract'}
      </p>
    </div>
  );
}

function ServiceChip({ text }) {
  if (!text) return null;
  return (
    <span className={`inline-flex min-w-0 max-w-[75%] flex-shrink-0 items-center px-[3cqmin] py-[0.9cqmin] rounded-full font-bold leading-tight ${CQ.chip} ${CHIP_TONE.muted}`}>
      <span className="truncate">{text}</span>
    </span>
  );
}

function Photo({ src, className }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) {
    return (
      <div className={`${className} overflow-hidden bg-gradient-to-br from-omega-charcoal via-[#4A3426] to-omega-orange`}>
        <HardHat className="absolute -right-[4%] -top-[20%] h-[140%] w-auto text-white/10" strokeWidth={1.5} />
      </div>
    );
  }
  return <img src={src} alt="" className={`${className} object-cover`} onError={() => setOk(false)} />;
}

// Wide / tall cards: cover photo banner with the client name on it.
function Banner({ job, height }) {
  return (
    <div className="relative flex-shrink-0 overflow-hidden" style={{ height }}>
      <Photo src={job.photo} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 px-6 pb-4 min-w-0">
        <p className={`${T.title} text-white truncate drop-shadow`}>{job.name}</p>
        <div className="mt-1.5 flex items-center gap-2 min-w-0">
          {job.service && (
            <span className="inline-flex min-w-0 items-center px-3 py-1 rounded-full font-bold leading-tight text-[clamp(11px,1.5vh,16px)] bg-white/90 text-[#111]">
              <span className="truncate">{job.service}</span>
            </span>
          )}
          {job.city && <span className={`${SMALL} font-semibold text-white/90 truncate`}>{job.city}</span>}
        </div>
      </div>
    </div>
  );
}

// Grid cards: the cover photo bleeds softly into the top-right corner behind
// the name, so the full card width stays free for text. Sized in % of the
// card so it grows with it.
function PhotoCorner({ src }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <img
      src={src}
      alt=""
      onError={() => setOk(false)}
      className="absolute top-0 right-0 w-[80%] h-[46%] object-cover pointer-events-none opacity-45"
      style={{
        WebkitMaskImage: 'radial-gradient(ellipse 100% 100% at 100% 0%, #000 25%, transparent 75%)',
        maskImage: 'radial-gradient(ellipse 100% 100% at 100% 0%, #000 25%, transparent 75%)',
      }}
    />
  );
}

function Header({ job }) {
  return (
    <div className="flex-shrink-0 min-w-0">
      <p className={`truncate text-[#111] ${CQ.name}`}>{job.name}</p>
      <div className="mt-[1.6cqmin] flex items-center gap-[2.5cqmin] min-w-0">
        <ServiceChip text={job.service} />
        {job.city && <span className={`${CQ.chip} font-semibold text-omega-slate truncate min-w-0`}>{job.city}</span>}
      </div>
    </div>
  );
}

function cardFrame(job) {
  const over = job.pct != null && job.pct > 1;
  const hex = job.tone ? TONE[job.tone].hex : NONE_HEX;
  return {
    className: `relative min-w-0 min-h-0 overflow-hidden rounded-3xl bg-white shadow-card flex flex-col ${
      over ? 'border-2 border-rose-400' : 'border border-black/[0.05]'
    }`,
    tint: (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(180deg, ${hex}${over ? '26' : '16'} 0%, ${hex}00 60%)` }}
      />
    ),
  };
}

function JobCard({ job, variant, count, index, reduce }) {
  const delay = Math.min(index * 0.035, 0.25);
  const frame = cardFrame(job);
  const enter = {
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay, ease: EASE },
  };

  if (variant === 'wide') {
    // One job: summary on the left, costs on the right. Two or three:
    // summary on top, costs underneath.
    const side = count === 1;
    return (
      <motion.div className={frame.className} {...enter}>
        <Banner job={job} height="clamp(80px,14vh,150px)" />
        <div className={`relative flex-1 min-h-0 flex px-7 py-6 ${side ? 'gap-12' : 'flex-col gap-5'}`}>
          {frame.tint}
          <div className={`relative flex items-center gap-8 min-w-0 flex-shrink-0 ${side ? 'w-[34%]' : ''}`}>
            <Gauge job={job} size={side ? 'clamp(150px,28vh,300px)' : 'clamp(130px,20vh,220px)'} numClass={side ? T.big : T.stat} capClass={SMALL} delay={delay} reduce={reduce} />
            <div className="flex-1 min-w-0">
              {count === 2
                ? <Figures job={job} money={usdFit} valueClass={T.stat} marginClass={T.big} showSpent grid />
                : <Figures job={job} money={usdFit} valueClass={NUM_SM} marginClass={T.stat} showSpent />}
            </div>
          </div>
          <div className={`relative flex-1 min-w-0 min-h-0 flex flex-col ${side ? 'justify-center' : ''}`}>
            <CostList job={job} size="lg" cols={side ? 2 : 1} center={side} delay={delay} reduce={reduce} />
          </div>
        </div>
      </motion.div>
    );
  }

  if (variant === 'tall') {
    return (
      <motion.div className={frame.className} {...enter}>
        <Banner job={job} height="clamp(76px,11vh,120px)" />
        <div className="relative flex-1 min-h-0 flex flex-col gap-4 px-6 pt-5 pb-5">
          {frame.tint}
          <div className="relative flex justify-center flex-shrink-0">
            <Gauge job={job} size="min(100%, 17vh)" numClass={T.stat} capClass={SMALL} delay={delay} reduce={reduce} />
          </div>
          <div className="relative flex-shrink-0">
            <Figures job={job} money={usdFit} valueClass={NUM_SM} marginClass={T.stat} />
          </div>
          <div className="relative flex-1 min-h-0 flex flex-col">
            <CostList job={job} size="md" delay={delay} reduce={reduce} />
          </div>
        </div>
      </motion.div>
    );
  }

  // Grid (7+ jobs). The card is a size container — see CQ.
  return (
    <motion.div className={`${frame.className} [container-type:size]`} {...enter}>
      {frame.tint}
      <PhotoCorner src={job.photo} />
      <div className="relative flex-1 min-h-0 flex flex-col gap-[3cqmin] px-[5.5cqmin] py-[4.5cqmin]">
        <Header job={job} />
        <div className="flex items-center gap-[4.5cqmin] flex-shrink-0 min-w-0">
          <Gauge job={job} size="31cqmin" numClass={CQ.pct} capClass={CQ.cap} delay={delay} reduce={reduce} />
          <div className="flex-1 min-w-0">
            <KeyFigure job={job} />
          </div>
        </div>
        <CostList job={job} size="cq" delay={delay} reduce={reduce} />
      </div>
    </motion.div>
  );
}

// When there are more jobs than tiles: one card that sums the rest.
function MoreCard({ jobs }) {
  const contract = jobs.reduce((s, j) => s + (j.contract || 0), 0);
  const spent = jobs.reduce((s, j) => s + j.spent, 0);
  return (
    <div className={`${CARD} min-w-0 min-h-0 overflow-hidden [container-type:size]`}>
      <div className="h-full flex flex-col items-center justify-center text-center gap-[1.5cqmin] px-[5cqmin]">
        <p className={`${CQ.key} text-[#111]`}>+{jobs.length} more</p>
        <p className={`${CQ.text} font-semibold text-omega-stone truncate max-w-full`}>{usdShort(contract)} contract</p>
        <p className={`${CQ.text} font-semibold text-omega-stone truncate max-w-full`}>{usdShort(spent)} committed</p>
      </div>
    </div>
  );
}

function Legend() {
  const dot = (hex, text) => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="w-3 h-3 rounded-full" style={{ background: hex }} />{text}
    </span>
  );
  const bar = (hex, text) => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="w-5 h-2 rounded-full" style={{ background: hex }} />{text}
    </span>
  );
  return (
    <div className={`${T.meta} flex items-center gap-5 flex-shrink-0`}>
      {dot(TONE.good.hex, 'Under 70%')}
      {dot(TONE.warn.hex, '70–90%')}
      {dot(TONE.bad.hex, '90%+')}
      <span className="w-px h-5 bg-black/10" />
      {bar(KIND.sub.hex, 'Subs')}
      {bar(KIND.office.hex, 'Office')}
      {bar(KIND.expense.hex, 'Other')}
    </div>
  );
}

// ─── Slide ───────────────────────────────────────────────────────────

export default function ProjectsSlide({ data }) {
  const reduce = useReducedMotion();
  const { jobs, totals } = useMemo(() => buildView(data), [data]);
  if (!data) return <SlideLoading />;

  if (!jobs.length) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <EmptyState icon={HardHat} title="No jobs in progress" text="Jobs show up here as soon as work starts." />
      </div>
    );
  }

  const grid = gridFor(jobs.length);
  const overflow = jobs.length > grid.capacity;
  const shown = overflow ? jobs.slice(0, grid.capacity - 1) : jobs;
  const rest = overflow ? jobs.slice(grid.capacity - 1) : [];

  const statusBits = [
    totals.over && `${totals.over} over budget`,
    totals.atRisk - totals.over > 0 && `${totals.atRisk - totals.over} at risk`,
    totals.noContract && `${totals.noContract} no contract`,
  ].filter(Boolean).slice(0, 2);

  // Two biggest buckets — a third doesn't fit the tile at 1080p.
  const costSub = [
    { n: totals.subs, text: 'subs' },
    { n: totals.office, text: 'office' },
    { n: totals.other, text: 'other' },
  ].filter((b) => b.n).sort((a, b) => b.n - a.n).slice(0, 2)
    .map((b) => `${usdShort(b.n)} ${b.text}`).join(' · ');

  const marginPct = totals.marginRatio != null ? Math.round(totals.marginRatio * 100) : null;
  const pctText = marginPct == null ? '' : `${marginPct < 0 ? '−' : ''}${Math.abs(marginPct)}%`;
  // With no sub agreements recorded the margin is just "contract minus
  // receipts" — call that out instead of painting a misleading green 100%.
  const noSubsYet = !totals.subs;
  const marginSub = marginPct == null
    ? 'no signed contracts yet'
    : noSubsYet
      ? `${pctText} · no sub agreements recorded yet`
      : `${pctText} of contract${totals.noContract && totals.costWithoutContract ? ' · signed jobs only' : ' value'}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <section className="flex-1 min-h-0 flex flex-col">
        <SectionTitle title="Cost vs contract">
          <Legend />
        </SectionTitle>
        <div
          className="flex-1 min-h-0 grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          }}
        >
          {shown.map((job, i) => (
            <JobCard key={job.id} job={job} variant={grid.variant} count={jobs.length} index={i} reduce={reduce} />
          ))}
          {overflow && <MoreCard jobs={rest} />}
        </div>
      </section>

      {/* Company totals — a quiet strip under the cards: the jobs are the
          story, these are context. */}
      <div className={`${CARD} grid grid-cols-4 divide-x divide-black/[0.06] py-3 flex-shrink-0`}>
        <TotalItem
          icon={HardHat}
          label="Jobs in progress"
          value={totals.count}
          sub={statusBits.length ? statusBits.join(' · ') : 'all within budget'}
        />
        <TotalItem
          icon={FileSignature}
          label="Contract value"
          value={totals.contracted ? totals.contractTotal : null}
          format={usdShort}
          sub={totals.contracted ? plural(totals.contracted, 'signed contract', 'signed contracts') : 'no signed contracts'}
        />
        <TotalItem
          icon={Wallet}
          label="Committed cost"
          value={totals.cost}
          format={usdShort}
          sub={costSub || 'nothing committed yet'}
        />
        <TotalItem
          icon={totals.margin != null && totals.margin < 0 ? TrendingDown : TrendingUp}
          label="Projected margin"
          value={totals.margin}
          format={usdShort}
          sub={marginSub}
          tone={noSubsYet ? undefined : marginTone(totals.marginRatio)}
        />
      </div>
    </div>
  );
}

// One segment of the totals strip: small icon, caps label, then the number
// (medium weight, not hero) with its explanation on the same line.
function TotalItem({ icon: Icon, label, value, format, sub, tone }) {
  const t = tone ? TONE[tone] : null;
  return (
    <div className="flex items-center gap-4 min-w-0 px-6">
      <span className={`w-[clamp(32px,4.4vh,46px)] h-[clamp(32px,4.4vh,46px)] rounded-xl flex items-center justify-center flex-shrink-0 ${t ? `${t.bg} ${t.text}` : 'bg-omega-cloud text-omega-slate'}`}>
        <Icon className="w-1/2 h-1/2" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`${T.eyebrow} leading-tight truncate`}>{label}</p>
        <p className="flex items-baseline gap-3 min-w-0 leading-tight">
          <CountUp
            value={value}
            format={format}
            className={`font-bold tabular-nums whitespace-nowrap text-[clamp(18px,2.6vh,28px)] ${t ? t.text : 'text-[#111]'}`}
          />
          {sub && <span className={`${T.meta} truncate min-w-0`}>{sub}</span>}
        </p>
      </div>
    </div>
  );
}
