// Marketing dashboard ("Insights") — the numbers that are Ramon's job:
// where leads come from, which channels convert, and (since Ramon
// cleared it) cost-per-lead by channel from the marketing_spend table.
//
// Read-only. Conversion = a lead whose job reached contract_signed,
// in_progress or completed (or whose lead_status is 'signed').

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Users, DollarSign, Target, Loader2 } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../../../shared/lib/supabase';
import { LEAD_SOURCES } from '../../receptionist/lib/leadCatalog';

const WON_PIPELINE = new Set(['contract_signed', 'in_progress', 'in-progress', 'completed']);

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
function leadDateOf(j) {
  return j.lead_date || j.created_at || null;
}

export default function MarketingDashboard({ user }) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [spend, setSpend] = useState({}); // channel -> monthly_amount
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [{ data: jobRows, error: jErr }, { data: spendRows }] = await Promise.all([
        supabase.from('jobs').select('lead_source, lead_date, created_at, pipeline_status, lead_status, service').limit(5000),
        supabase.from('marketing_spend').select('channel, monthly_amount'),
      ]);
      if (jErr) throw jErr;
      setJobs(jobRows || []);
      const sp = {};
      for (const r of spendRows || []) sp[r.channel] = Number(r.monthly_amount) || 0;
      setSpend(sp);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = monthKey(now);

    const won = (j) => WON_PIPELINE.has(j.pipeline_status) || j.lead_status === 'signed';
    const sourceOf = (j) => j.lead_source || 'Other';

    // Per-source aggregates (all-time) + this-month counts.
    const bySource = {};
    const ensure = (s) => (bySource[s] ||= { source: s, total: 0, won: 0, thisMonth: 0 });
    for (const j of jobs) {
      const s = sourceOf(j);
      const row = ensure(s);
      row.total += 1;
      if (won(j)) row.won += 1;
      const ld = leadDateOf(j);
      if (ld && monthKey(ld) === thisMonth) row.thisMonth += 1;
    }

    const sourceRows = Object.values(bySource)
      .map((r) => ({
        ...r,
        conversion: r.total > 0 ? (r.won / r.total) * 100 : 0,
        spend: spend[r.source] || 0,
        cpl: (spend[r.source] || 0) > 0 && r.thisMonth > 0 ? (spend[r.source] / r.thisMonth) : null,
      }))
      .sort((a, b) => b.total - a.total);

    const totalLeads = jobs.length;
    const totalWon = jobs.filter(won).length;
    const winRate = totalLeads > 0 ? (totalWon / totalLeads) * 100 : 0;
    const leadsThisMonth = sourceRows.reduce((s, r) => s + r.thisMonth, 0);
    const monthlySpend = Object.values(spend).reduce((s, n) => s + (Number(n) || 0), 0);
    const overallCpl = leadsThisMonth > 0 && monthlySpend > 0 ? monthlySpend / leadsThisMonth : null;

    // Leads per month — last 6 months.
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      const count = jobs.filter((j) => { const ld = leadDateOf(j); return ld && monthKey(ld) === key; }).length;
      trend.push({ key, label: d.toLocaleDateString('en-US', { month: 'short' }), count });
    }
    const trendMax = Math.max(1, ...trend.map((t) => t.count));
    const maxSourceTotal = Math.max(1, ...sourceRows.map((r) => r.total));

    return { sourceRows, totalLeads, winRate, leadsThisMonth, monthlySpend, overallCpl, trend, trendMax, maxSourceTotal, hasSpend: monthlySpend > 0 };
  }, [jobs, spend]);

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <PageHeader icon={BarChart3} title="Insights" subtitle="Lead sources, conversion & cost per lead" />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-omega-stone"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Users}      label={`Leads · ${monthName}`} value={String(stats.leadsThisMonth)} sub={`${stats.totalLeads} all-time`} />
            <Kpi icon={DollarSign} label="Monthly Spend"          value={money(stats.monthlySpend)}     sub={stats.hasSpend ? 'across channels' : 'not set yet'} />
            <Kpi icon={Target}     label="Cost / Lead"            value={stats.overallCpl == null ? '—' : money(stats.overallCpl)} sub="this month" valueColor="text-omega-orange" />
            <Kpi icon={TrendingUp} label="Win Rate"               value={`${stats.winRate.toFixed(0)}%`} sub="leads → signed" valueColor="text-emerald-600" />
          </div>

          {/* Leads by source + conversion */}
          <Card title="Leads by Source" subtitle="All-time volume and how many converted">
            <div className="space-y-2.5">
              {stats.sourceRows.filter((r) => r.total > 0).map((r) => (
                <div key={r.source} className="flex items-center gap-3">
                  <div className="w-28 flex-shrink-0 text-sm font-semibold text-omega-charcoal truncate">{r.source}</div>
                  <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full bg-omega-orange/80 rounded-full" style={{ width: `${(r.total / stats.maxSourceTotal) * 100}%` }} />
                    <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold text-omega-charcoal">{r.total}</span>
                  </div>
                  <div className="w-24 flex-shrink-0 text-right text-[12px] text-omega-stone">
                    <span className="font-bold text-emerald-600">{r.conversion.toFixed(0)}%</span> won
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Spend & CPL by channel */}
          <Card title="Spend & Cost per Lead" subtitle={`Based on ${monthName} leads`}>
            {!stats.hasSpend ? (
              <p className="text-sm text-omega-stone">
                No marketing spend set yet. Once the spend per channel is filled in (Admin → Marketing Spend),
                cost-per-lead shows up here automatically.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-omega-stone border-b border-gray-100">
                      <th className="text-left py-2">Channel</th>
                      <th className="text-right py-2">Monthly Spend</th>
                      <th className="text-right py-2">Leads (mo.)</th>
                      <th className="text-right py-2">Cost / Lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sourceRows.filter((r) => r.spend > 0 || r.thisMonth > 0).map((r) => (
                      <tr key={r.source} className="border-b border-gray-50">
                        <td className="py-2 font-semibold text-omega-charcoal">{r.source}</td>
                        <td className="py-2 text-right tabular-nums">{r.spend > 0 ? money(r.spend) : '—'}</td>
                        <td className="py-2 text-right tabular-nums">{r.thisMonth}</td>
                        <td className="py-2 text-right tabular-nums font-bold text-omega-orange">{r.cpl == null ? '—' : money(r.cpl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 6-month trend */}
          <Card title="Leads — last 6 months" subtitle="New leads entered per month">
            <div className="flex items-end justify-between gap-2 h-32">
              {stats.trend.map((t) => (
                <div key={t.key} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-[11px] font-bold text-omega-charcoal tabular-nums">{t.count}</span>
                  <div className="w-full bg-omega-orange/80 rounded-t-md" style={{ height: `${(t.count / stats.trendMax) * 100}%`, minHeight: t.count > 0 ? '4px' : '0' }} />
                  <span className="text-[10px] text-omega-stone">{t.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, valueColor = 'text-omega-charcoal' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-center gap-1.5 text-omega-stone">
        <Icon className="w-3.5 h-3.5" />
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-2xl font-black mt-1 tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-omega-stone mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="mb-4">
        <h3 className="font-bold text-omega-charcoal">{title}</h3>
        {subtitle && <p className="text-[12px] text-omega-stone mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
