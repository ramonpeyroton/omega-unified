import { useEffect, useMemo, useState } from 'react';
import {
  Megaphone, ChevronLeft, ChevronRight, Save, Loader2, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../../../shared/lib/audit';
import { LEAD_SOURCES } from '../../receptionist/lib/leadCatalog';

// MarketingSpend — admin/owner/operations screen for capturing how
// much Omega invested in each lead source per calendar month.
//
// The Owner Dashboard's Marketing Overview reads from here to surface
// Cost per Lead per channel and a 'Best ROI' callout.
//
// UX choices:
//   • One row per channel from the LEAD_SOURCES catalog (so the form
//     mirrors the dropdown the receptionist sees on NewLead).
//   • Single month at a time, with prev/next buttons to scrub.
//   • Inline edit + single Save button — no per-row save chrome.
//     Brenda fills the whole month in one pass.
//   • Saved values persist via UPSERT on (channel, period_start),
//     so saving the same month twice updates instead of duplicating.

function firstOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtMonth(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fmtMonthIso(date) {
  // YYYY-MM-01
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function shiftMonth(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function MarketingSpend({ user }) {
  const [period, setPeriod]       = useState(() => firstOfMonth());
  const [rowsByChannel, setRowsByChannel] = useState({}); // channel → { amount, notes, id?, dirty? }
  const [originalsByChannel, setOriginalsByChannel] = useState({});
  const [leadsByChannel, setLeadsByChannel] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const periodIso = useMemo(() => fmtMonthIso(period), [period]);
  const isCurrentMonth = period.getTime() === firstOfMonth().getTime();
  const periodEnd = useMemo(() => shiftMonth(period, 1), [period]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      setSavedAt(null);
      try {
        // 1. Existing spend rows for this month.
        const { data: spend } = await supabase
          .from('marketing_spend')
          .select('*')
          .eq('period_start', periodIso);

        // Seed every channel from the catalog with 0; overlay any
        // existing rows on top.
        const seeded = {};
        for (const ch of LEAD_SOURCES) {
          seeded[ch] = { amount: '', notes: '', id: null, dirty: false };
        }
        for (const row of (spend || [])) {
          seeded[row.channel] = {
            amount: row.amount != null ? String(row.amount) : '',
            notes:  row.notes || '',
            id:     row.id,
            dirty:  false,
          };
        }
        if (active) {
          setRowsByChannel(seeded);
          setOriginalsByChannel(JSON.parse(JSON.stringify(seeded)));
        }

        // 2. Leads count by channel for the same month — drives the
        // CPL preview in the right column.
        const { data: jobs } = await supabase
          .from('jobs')
          .select('lead_source, lead_date, created_at')
          .gte('lead_date', periodIso)
          .lt('lead_date', fmtMonthIso(periodEnd));
        const counts = {};
        for (const j of (jobs || [])) {
          const k = j.lead_source || 'Other';
          counts[k] = (counts[k] || 0) + 1;
        }
        if (active) setLeadsByChannel(counts);
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [periodIso, periodEnd]);

  function setField(channel, field, value) {
    setRowsByChannel((prev) => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        [field]: value,
        dirty: true,
      },
    }));
    setSavedAt(null);
  }

  const dirtyCount = useMemo(() =>
    Object.values(rowsByChannel).filter((r) => r.dirty).length,
  [rowsByChannel]);

  async function saveAll() {
    setSaving(true);
    setError('');
    try {
      const payload = [];
      for (const [channel, row] of Object.entries(rowsByChannel)) {
        if (!row.dirty) continue;
        const amt = row.amount === '' || row.amount == null ? 0 : Number(row.amount);
        if (!Number.isFinite(amt)) continue;
        payload.push({
          channel,
          period_start: periodIso,
          amount: amt,
          notes: row.notes || null,
        });
      }
      if (payload.length === 0) return;
      const { error: e } = await supabase
        .from('marketing_spend')
        .upsert(payload, { onConflict: 'channel,period_start' });
      if (e) throw e;

      logAudit({
        user, action: 'marketing.spend_update',
        details: { period: periodIso, rows: payload.length },
      });

      // Reload to pick up freshly-assigned ids and clear dirty flags.
      setOriginalsByChannel(JSON.parse(JSON.stringify(rowsByChannel)));
      setRowsByChannel((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) next[k] = { ...next[k], dirty: false };
        return next;
      });
      setSavedAt(new Date());
    } catch (err) {
      setError(err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const totalSpend = Object.values(rowsByChannel).reduce(
    (s, r) => s + (Number(r.amount) || 0), 0,
  );
  const totalLeads = Object.values(leadsByChannel).reduce((s, n) => s + n, 0);
  const overallCpl = totalLeads === 0 ? null : totalSpend / totalLeads;

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <div className="max-w-4xl mx-auto p-4 md:p-6 lg:p-8 space-y-5">
        <header>
          <h1 className="text-2xl font-black text-omega-charcoal inline-flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-omega-orange" /> Marketing Spend
          </h1>
          <p className="text-sm text-omega-stone mt-1">
            Monthly investment by channel. Drives Cost per Lead on the Owner Dashboard.
          </p>
        </header>

        {/* Month picker */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPeriod((p) => shiftMonth(p, -1))}
            className="p-2 rounded-lg border border-gray-200 hover:border-omega-orange text-omega-charcoal"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">
              {isCurrentMonth ? 'Current Month' : 'Period'}
            </p>
            <p className="text-lg font-black text-omega-charcoal">{fmtMonth(period)}</p>
          </div>
          <button
            type="button"
            onClick={() => setPeriod((p) => shiftMonth(p, 1))}
            className="p-2 rounded-lg border border-gray-200 hover:border-omega-orange text-omega-charcoal"
            disabled={isCurrentMonth}
            style={{ opacity: isCurrentMonth ? 0.4 : 1 }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total Spend"       value={fmtMoney(totalSpend)} />
          <Stat label="Leads This Month"  value={String(totalLeads)} />
          <Stat label="Cost per Lead"     value={overallCpl == null ? '—' : fmtMoney(overallCpl)} />
        </div>

        {/* Channels table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          {loading ? (
            <p className="text-sm text-omega-stone py-12 text-center">
              <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Loading…
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-omega-cloud">
                <tr className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">
                  <th className="text-left py-2 px-4">Channel</th>
                  <th className="text-right py-2 px-4 w-[140px]">Spend</th>
                  <th className="text-right py-2 px-4 w-[100px]">Leads</th>
                  <th className="text-right py-2 px-4 w-[110px]">CPL</th>
                  <th className="text-left py-2 px-4 w-[200px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {LEAD_SOURCES.map((channel) => {
                  const row = rowsByChannel[channel] || { amount: '', notes: '', dirty: false };
                  const leadsCount = leadsByChannel[channel] || 0;
                  const cpl = leadsCount === 0 ? null : (Number(row.amount) || 0) / leadsCount;
                  return (
                    <tr key={channel} className={`border-t border-gray-100 ${row.dirty ? 'bg-omega-pale/30' : ''}`}>
                      <td className="py-2 px-4 font-bold text-omega-charcoal">{channel}</td>
                      <td className="py-2 px-4">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-omega-stone text-xs">$</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.amount}
                            onChange={(e) => setField(channel, 'amount', e.target.value)}
                            className="w-full pl-6 pr-2 py-1.5 text-sm text-right rounded-lg border border-gray-200 focus:border-omega-orange outline-none tabular-nums"
                            placeholder="0"
                          />
                        </div>
                      </td>
                      <td className="py-2 px-4 text-right text-sm tabular-nums text-omega-charcoal">{leadsCount}</td>
                      <td className="py-2 px-4 text-right text-sm tabular-nums font-bold text-omega-orange">
                        {cpl == null ? '—' : fmtMoney(cpl)}
                      </td>
                      <td className="py-2 px-4">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) => setField(channel, 'notes', e.target.value)}
                          placeholder="Optional"
                          className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-200 focus:border-omega-orange outline-none"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Save bar */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-omega-stone">
            {dirtyCount > 0 && (
              <span className="text-amber-700 font-bold">
                {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
              </span>
            )}
            {dirtyCount === 0 && savedAt && (
              <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved {savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            {dirtyCount === 0 && !savedAt && (
              <span>Tap a Spend cell to start editing this month.</span>
            )}
          </div>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving || dirtyCount === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-bold"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 inline-flex items-start gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">{label}</p>
      <p className="text-xl font-black text-omega-charcoal tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
