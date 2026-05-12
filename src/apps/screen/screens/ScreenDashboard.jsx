import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LogOut, TrendingUp, TrendingDown, Minus,
  DollarSign, FileSignature, Users, Package,
} from 'lucide-react';
import logoImg from '../../../assets/logo.png';
import { supabase } from '../../../shared/lib/supabase';
import { getSettingNumber } from '../../../shared/lib/settings';
import { loadScreenOverrides, pickKpi } from '../../../shared/lib/screenOverrides';
import { formatHeaderDate, formatClockTime } from '../lib/ranges';
import {
  loadMonthKpi, loadYtdRevenue, loadMonthlyRevenue,
  loadPipelineDistribution, loadServiceMix, loadPipelineValue,
} from '../lib/metrics';
import { unlockAudio, isUnlocked } from '../lib/bells';
import Celebration from '../components/Celebration';
import { Donut, BarChart, HBars } from '../components/Charts';
import VoiceCommandBar from '../components/VoiceCommandBar';
import { PIPELINE_COLORS, PIPELINE_STEP_LABEL, PIPELINE_ORDER } from '../../../shared/config/phaseBreakdown';

const DATA_REFRESH_MS = 60_000;
const CLOCK_TICK_MS  = 1_000;

// ─── Formatting ─────────────────────────────────────────────────────
function moneyShort(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  if (v > 0)          return `$${Math.round(v).toLocaleString()}`;
  return '—';
}
function moneyFull(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '$0';
  return `$${Math.round(v).toLocaleString()}`;
}
function fmtInt(n) { return (Number(n) || 0).toLocaleString(); }

function delta(curr, prev) {
  const c = Number(curr) || 0; const p = Number(prev) || 0;
  if (p === 0 && c === 0) return { label: '—', trend: 'flat' };
  if (p === 0)            return { label: 'NEW', trend: 'up' };
  const d = c - p;
  if (d === 0) return { label: '±0', trend: 'flat' };
  return { label: `${d > 0 ? '+' : ''}${Math.round((d / p) * 100)}%`, trend: d > 0 ? 'up' : 'down' };
}

// KPI accent colors — match the GestorPro reference palette.
const ACCENTS = {
  revenue:   { bg: '#3B82F6', soft: 'rgba(59,130,246,0.15)' },  // blue
  contracts: { bg: '#22C55E', soft: 'rgba(34,197,94,0.15)' },   // green
  leads:     { bg: '#A855F7', soft: 'rgba(168,85,247,0.15)' },  // purple
  avg:       { bg: '#F97316', soft: 'rgba(249,115,22,0.15)' },  // omega orange
};

function fmtSignedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ScreenDashboard({ onLogout }) {
  const [now, setNow]           = useState(() => new Date());
  const [month, setMonth]       = useState(null);
  const [ytd, setYtd]           = useState(0);
  const [goal, setGoal]         = useState(6_000_000);
  const [monthly, setMonthly]   = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [pipelineVal, setPipelineVal] = useState(0);
  const [mix, setMix]           = useState([]);
  const [recent, setRecent]     = useState([]);
  const [override, setOverride] = useState({});
  const [celebrations, setCelebrations] = useState([]);

  const seenEventIds = useRef(new Set());
  const [soundReady, setSoundReady] = useState(false);

  // ─── Initial + periodic data load ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [m, y, g, mo, pipe, sm, ov, recentCtr, pv] = await Promise.all([
        loadMonthKpi(),
        loadYtdRevenue(),
        getSettingNumber('annual_goal_2026', 6_000_000),
        loadMonthlyRevenue(6),
        loadPipelineDistribution(),
        loadServiceMix(),
        loadScreenOverrides(),
        loadRecentContracts(5),
        loadPipelineValue(),
      ]);
      if (cancelled) return;
      setMonth(m); setYtd(y); setGoal(g);
      setMonthly(mo); setPipeline(pipe); setMix(sm);
      setOverride(ov); setRecent(recentCtr); setPipelineVal(pv);
    }
    load();
    const iv = setInterval(load, DATA_REFRESH_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onLogout?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLogout]);

  // Unlock Web Audio on first user gesture.
  useEffect(() => {
    function unlock() { if (unlockAudio()) setSoundReady(true); }
    if (isUnlocked()) setSoundReady(true);
    else {
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown',     unlock, { once: true });
    }
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown',     unlock);
    };
  }, []);

  // ─── Realtime celebrations ────────────────────────────────────────
  useEffect(() => {
    const chan = supabase
      .channel('screen-celebrations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, (payload) => {
        const row = payload?.new;
        if (!row?.id || seenEventIds.current.has(`lead:${row.id}`)) return;
        seenEventIds.current.add(`lead:${row.id}`);
        setCelebrations((c) => [...c, {
          id: `lead:${row.id}:${Date.now()}`, kind: 'lead',
          subtitle: [row.client_name, row.city || row.service].filter(Boolean).join(' · '),
        }]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contracts' }, (payload) => {
        const n = payload?.new; const o = payload?.old;
        if (!n?.id || !n.signed_at || o?.signed_at) return;
        const dedup = `ctr:${n.job_id || n.id}`;
        if (seenEventIds.current.has(dedup)) return;
        seenEventIds.current.add(dedup);
        setCelebrations((c) => [...c, {
          id: `${dedup}:${Date.now()}`, kind: 'contract',
          subtitle: n.total_amount ? `$${Number(n.total_amount).toLocaleString()}` : undefined,
        }]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, (payload) => {
        const n = payload?.new; const o = payload?.old;
        if (!n?.id || n.pipeline_status !== 'contract_signed' || o?.pipeline_status === 'contract_signed') return;
        const dedup = `ctr:${n.id}`;
        if (seenEventIds.current.has(dedup)) return;
        seenEventIds.current.add(dedup);
        setCelebrations((c) => [...c, {
          id: `${dedup}:${Date.now()}`, kind: 'contract',
          subtitle: [n.client_name, n.service].filter(Boolean).join(' · '),
        }]);
      })
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  }, []);

  function dismissCelebration(id) {
    setCelebrations((c) => c.filter((x) => x.id !== id));
  }

  // ─── Derived KPIs — override wins, then live data ────────────────
  // Pipeline value is the live total $ of active jobs' latest estimates,
  // excluding LOST (`estimate_rejected`) and COMPLETED jobs.
  const liveAvg = month?.contracts ? (month?.revenue || 0) / month.contracts : 0;
  const kpis = {
    pipeline:  pickKpi(pipelineVal, override?.pipeline_value),
    contracts: pickKpi(month?.contracts || 0, override?.contracts_signed),
    leads:     pickKpi(month?.leads || 0, override?.new_leads),
    avg:       pickKpi(liveAvg, override?.avg_job_value),
  };
  const kpiDeltas = {
    pipeline:  null, // pipeline value is a live stock, not a month-over-month flow
    contracts: delta(month?.contracts, month?.prev?.contracts),
    leads:     delta(month?.leads,     month?.prev?.leads),
    avg:       delta(liveAvg, month?.prev?.contracts ? (month?.prev?.revenue || 0) / month.prev.contracts : 0),
  };

  const goalPct = useMemo(() => {
    if (!goal) return 0;
    return Math.max(0, Math.min(100, Math.round((ytd / goal) * 10000) / 100));
  }, [ytd, goal]);

  // Pipeline donut slices
  const pipelineSlices = useMemo(() => {
    const map = Object.fromEntries(pipeline.map((p) => [p.status, p.count]));
    return PIPELINE_ORDER
      .map((status) => ({
        status,
        label: PIPELINE_STEP_LABEL[status] || status,
        value: map[status] || 0,
        color: PIPELINE_COLORS[status]?.hex || '#6B7280',
      }))
      .filter((s) => s.value > 0);
  }, [pipeline]);
  const pipelineTotal = pipelineSlices.reduce((a, s) => a + s.value, 0);

  // Recent contracts: override wins when populated
  const recentContracts = (Array.isArray(override?.recent_contracts) && override.recent_contracts.length)
    ? override.recent_contracts
    : recent;

  // Top services: override wins when populated, else service mix
  const topServices = (Array.isArray(override?.top_services) && override.top_services.length)
    ? override.top_services.map((s) => ({ label: s.service, value: Number(s.revenue) || Number(s.count) || 0 }))
    : mix.slice(0, 5);

  return (
    <div className="h-screen w-screen bg-[#0a0e18] text-white select-none overflow-hidden font-sans flex flex-col">
      <div className="absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.15),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.08),transparent_50%)]" />

      {/* ═══ Voice command bar — Firestick remote target ══════════ */}
      <VoiceCommandBar />

      {/* ═══ Top strip ═════════════════════════════════════════════ */}
      <header className="relative z-10 flex items-center gap-4 px-6 pt-4 pb-3 border-b border-white/[0.06]">
        <img src={logoImg} alt="Omega" className="h-9 w-auto opacity-95 flex-shrink-0" />
        <div className="flex items-baseline gap-3 min-w-0">
          <p className="text-white/45 text-[10px] uppercase tracking-[0.3em] font-semibold">Omega Pulse</p>
          <p className="text-white font-bold text-sm truncate">{formatHeaderDate(now)}</p>
          <p className="text-white/50 text-xs font-mono tabular-nums">{formatClockTime(now)}</p>
        </div>

        <div className="ml-auto flex items-center gap-3 min-w-[360px]">
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/50 whitespace-nowrap">2026 Goal</p>
          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-omega-orange to-amber-400 transition-all duration-700 shadow-[0_0_12px_rgba(249,115,22,0.6)]"
              style={{ width: `${goalPct}%` }}
            />
          </div>
          <p className="text-white/60 text-[11px] font-semibold tabular-nums whitespace-nowrap">
            <span className="text-white font-black">{moneyShort(ytd)}</span>
            <span className="mx-0.5 text-white/30">/</span>
            {moneyShort(goal)}
          </p>
          <p className="text-omega-orange font-black text-xs tabular-nums w-[44px] text-right">{goalPct}%</p>
        </div>

        <button onClick={onLogout} className="text-white/25 hover:text-white/70 text-[10px] uppercase tracking-widest inline-flex items-center gap-1">
          <LogOut className="w-3 h-3" /> Esc
        </button>
      </header>

      {!soundReady && (
        <div className="relative z-20 flex justify-center pt-1">
          <span className="text-[10px] uppercase tracking-widest text-white/45 bg-white/[0.04] border border-white/10 rounded-full px-3 py-1 animate-pulse">
            🔔 Click anywhere to enable celebration sounds
          </span>
        </div>
      )}

      {/* ═══ Greeting — compact row that merges with period ══════ */}
      <section className="relative z-10 px-6 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-black text-white leading-tight">Omega Development</h1>
          <p className="text-white/50 text-sm">
            {override?.note || `Here's how the business is doing this month.`}
          </p>
        </div>
        <p className="text-white font-bold text-sm uppercase tracking-wider">
          {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>
      </section>

      {/* ═══ 4 Headline KPI cards ════════════════════════════════ */}
      <section className="relative z-10 px-6 pb-3 grid grid-cols-4 gap-3 flex-shrink-0">
        <KpiTile
          icon={DollarSign}
          accent={ACCENTS.revenue}
          label="Pipeline Value"
          value={moneyShort(kpis.pipeline)}
          delta={kpiDeltas.pipeline}
          sub="active jobs · excl. LOST"
          overriddn={override?.pipeline_value != null}
        />
        <KpiTile
          icon={FileSignature}
          accent={ACCENTS.contracts}
          label="Contracts Signed"
          value={fmtInt(kpis.contracts)}
          delta={kpiDeltas.contracts}
          sub="this month"
          overriddn={override?.contracts_signed != null}
        />
        <KpiTile
          icon={Users}
          accent={ACCENTS.leads}
          label="New Leads"
          value={fmtInt(kpis.leads)}
          delta={kpiDeltas.leads}
          sub="this month"
          overriddn={override?.new_leads != null}
        />
        <KpiTile
          icon={Package}
          accent={ACCENTS.avg}
          label="Avg Job Value"
          value={moneyShort(kpis.avg)}
          delta={kpiDeltas.avg}
          sub="per contract"
          overriddn={override?.avg_job_value != null}
        />
      </section>

      {/* ═══ 4 panels in ONE row — sized to fill the remaining TV height.
           Widescreen 16:9 hates tall stacks; a single wide row fills the
           screen without scroll or clipping. */}
      <section className="relative z-10 px-6 pb-4 grid grid-cols-[1.3fr_0.9fr_1.2fr_0.9fr] gap-3 flex-1 min-h-0">
        <Panel title="Revenue · Last 6 Months" subtitle={moneyFull(monthly.reduce((a, b) => a + (b.value || 0), 0))}>
          <BarChart bars={monthly} height={220} color="#3B82F6" />
        </Panel>

        <Panel title="Pipeline by Status" subtitle={`${pipelineTotal} jobs`}>
          <div className="flex flex-col items-center gap-3 pt-1 h-full">
            <Donut slices={pipelineSlices} size={160} thickness={22} centerLabel="Total" centerValue={pipelineTotal} />
            <div className="flex-1 w-full space-y-1 min-w-0 overflow-hidden">
              {pipelineSlices.slice(0, 5).map((s) => (
                <LegendRow key={s.status} color={s.color} label={s.label} value={s.value} />
              ))}
              {pipelineSlices.length === 0 && (
                <p className="text-white/40 text-xs italic">No jobs yet.</p>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Recent Contracts Signed" subtitle={recentContracts.length ? `${recentContracts.length} shown` : ''}>
          <div className="space-y-1.5 overflow-hidden">
            {recentContracts.length === 0 && (
              <p className="text-white/40 text-xs italic">No contracts yet.</p>
            )}
            {recentContracts.slice(0, 5).map((c, i) => (
              <ContractRow key={i} rank={i + 1} contract={c} />
            ))}
          </div>
        </Panel>

        <Panel title="Top Services">
          {topServices.length === 0
            ? <p className="text-white/40 text-xs italic">No data yet.</p>
            : <HBars rows={topServices.slice(0, 5)} color="#22C55E" />}
        </Panel>
      </section>

      <Celebration items={celebrations} onDone={dismissCelebration} />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function Panel({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4 flex flex-col min-h-0 backdrop-blur-sm">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-white/70 text-[11px] uppercase tracking-[0.25em] font-bold">{title}</h2>
        {subtitle && <p className="text-white/40 text-[11px] font-semibold tabular-nums">{subtitle}</p>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function KpiTile({ icon: Icon, accent, label, value, delta: d, sub, overriddn }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3.5 relative overflow-hidden">
      <div
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-30 blur-2xl pointer-events-none"
        style={{ background: accent.bg }}
      />
      <div className="flex items-center justify-between mb-1 relative">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: accent.soft }}>
            <Icon className="w-5 h-5" style={{ color: accent.bg }} />
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-bold">{label}</p>
        </div>
        {overriddn && (
          <span className="text-[8px] uppercase tracking-wider font-bold text-amber-300/80 bg-amber-400/10 border border-amber-400/20 rounded-full px-1.5 py-0.5" title="Manual value set in Admin">
            manual
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 mt-2 relative">
        <p className="text-3xl font-black leading-none tabular-nums text-white">{value}</p>
        {d && <DeltaChip delta={d} />}
      </div>
      <p className="text-white/45 text-[10px] font-semibold mt-1.5 uppercase tracking-wider">{sub}</p>
    </div>
  );
}

function DeltaChip({ delta: d }) {
  const color =
    d.trend === 'up'   ? 'text-emerald-400 bg-emerald-400/10' :
    d.trend === 'down' ? 'text-red-400 bg-red-400/10'         :
                         'text-white/40 bg-white/[0.05]';
  const Icon =
    d.trend === 'up'   ? TrendingUp :
    d.trend === 'down' ? TrendingDown : Minus;
  return (
    <p className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md ${color}`}>
      <Icon className="w-3 h-3" /> {d.label}
    </p>
  );
}

function LegendRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
      <span className="text-[12px] text-white/80 font-semibold truncate flex-1">{label}</span>
      <span className="text-[12px] text-white font-black tabular-nums">{value}</span>
    </div>
  );
}

function ContractRow({ rank, contract }) {
  const client = contract.client || contract.client_name || 'Client';
  const service = contract.service || '—';
  const amount  = contract.amount ?? contract.total_amount;
  const signed  = contract.signed_at;
  return (
    <div className="rounded-lg bg-white/[0.04] border border-white/5 px-3 py-2 flex items-center gap-3 hover:bg-white/[0.06] transition-colors">
      <span className="text-white/35 font-bold text-xs tabular-nums w-5 text-right">#{String(rank).padStart(2, '0')}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-white truncate leading-tight">{client}</p>
        <p className="text-white/50 text-[11px] font-semibold truncate">{service}</p>
      </div>
      <p className="text-emerald-400 font-black text-[13px] tabular-nums whitespace-nowrap">{moneyShort(amount)}</p>
      {signed && <p className="text-white/35 text-[10px] font-bold w-[52px] text-right">{fmtSignedAt(signed)}</p>}
    </div>
  );
}

// ─── Helper: live recent contracts loader ──────────────────────────
async function loadRecentContracts(limit = 5) {
  try {
    const { data } = await supabase
      .from('contracts')
      .select('id, signed_at, total_amount, job_id')
      .not('signed_at', 'is', null)
      .order('signed_at', { ascending: false })
      .limit(limit);
    if (!data?.length) return [];
    // Pull client/service for the jobs referenced by these contracts.
    const jobIds = data.map((c) => c.job_id).filter(Boolean);
    const jobsById = {};
    if (jobIds.length) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, client_name, service')
        .in('id', jobIds);
      for (const j of jobs || []) jobsById[j.id] = j;
    }
    return data.map((c) => {
      const j = jobsById[c.job_id] || {};
      return {
        client:    j.client_name || '—',
        service:   j.service     || '—',
        amount:    c.total_amount,
        signed_at: c.signed_at,
      };
    });
  } catch { return []; }
}
