import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Truck, Circle, Loader2, Phone, PackageCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '../../shared/lib/supabase';
import { STATUSES, listProgress, setItemStatus } from '../../shared/lib/purchaseLists';
import { SERVICE_LABEL, parseJobServices } from '../../shared/data/services';
import logo from '../../assets/logo.png';

// Public, auth-less page: the client's purchase list (migration 088).
// URL: /purchase-list/:id — sent by SMS + email when Attila clicks Send.
// Each item: Not purchased yet / Ordered (arrives on…) / At the house.
// Everyone with the link sees the same list, live: if one spouse marks the
// tile in the morning, the other sees it in the afternoon. No name asked —
// one tap per item (Ramon, 13/10/26); the team sees "Client" + the date.
// ?preview=1 = the team looking at a list before sending (read-only).

const ORANGE = '#E8732A';
const OFFICE_PHONE = '(203) 451-4846';

function prettyDay(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function when(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUS_STYLE = {
  not_purchased: { icon: Circle,       on: 'bg-gray-800 text-white border-gray-800', chip: 'bg-gray-100 text-gray-600' },
  ordered:       { icon: Truck,        on: 'bg-amber-500 text-white border-amber-500', chip: 'bg-amber-100 text-amber-800' },
  at_house:      { icon: PackageCheck, on: 'bg-green-600 text-white border-green-600', chip: 'bg-green-100 text-green-700' },
};

export default function PurchaseListView() {
  const listId = useMemo(() => window.location.pathname.split('/purchase-list/')[1]?.split(/[/?#]/)[0], []);
  const preview = useMemo(() => new URLSearchParams(window.location.search).get('preview') === '1', []);
  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);       // item id being saved

  const load = useCallback(async () => {
    if (!listId) { setError('This link is incomplete.'); setLoading(false); return; }
    const { data: l, error: e } = await supabase.from('purchase_lists').select('*').eq('id', listId).maybeSingle();
    if (e || !l) { setError('We couldn\'t find this list. Please call us.'); setLoading(false); return; }
    const [{ data: its }, { data: j }] = await Promise.all([
      supabase.from('purchase_list_items').select('*').eq('list_id', listId).order('position'),
      supabase.from('jobs').select('client_name, address, service').eq('id', l.job_id).maybeSingle(),
    ]);
    setList(l);
    setItems(its || []);
    setJob(j || null);
    setLoading(false);
  }, [listId]);

  useEffect(() => { load(); }, [load]);

  // Live: someone else (or the office) marks an item → it shows here.
  useEffect(() => {
    if (!listId) return undefined;
    const ch = supabase.channel(`purchase-list-${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_list_items', filter: `list_id=eq.${listId}` }, () => load())
      .subscribe();
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    // Safety net if realtime drops: re-read every 20s while the page is open.
    const poll = setInterval(load, 20_000);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(poll);
    };
  }, [listId, load]);

  async function change(item, patch) {
    if (preview) return;
    setSaving(item.id);
    try {
      const updated = await setItemStatus(item, patch, { name: null, kind: 'client' }, list);
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch {
      alert('Could not save. Please check your connection and try again.');
    } finally {
      setSaving(null);
    }
  }


  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }
  if (error || (list?.status === 'draft' && !preview)) {
    return (
      <Shell>
        <p className="text-center text-gray-600 py-10">{error || 'This list isn\'t ready yet. We\'ll send you the link as soon as it is.'}</p>
      </Shell>
    );
  }

  const p = listProgress(items, todayKey());
  const pct = p.total ? Math.round((p.atHouse / p.total) * 100) : 0;
  const first = String(job?.client_name || '').trim().split(/\s+/)[0];
  const project = parseJobServices(job?.service).map((s) => SERVICE_LABEL[s] || s).join(' + ');

  return (
    <Shell>
      {preview && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          Preview — this is what the client sees. {list.status === 'draft' ? 'Not sent yet.' : ''} Changes are off here.
        </div>
      )}
      <h1 className="text-2xl font-black text-[#2C2C2A]">{first ? `Hi ${first},` : 'Your purchase list'}</h1>
      <p className="mt-1 text-[15px] text-gray-600 leading-relaxed">
        Before we start your {project ? <strong>{project}</strong> : 'project'}{job?.address ? <> at {job.address}</> : null}, please purchase the items below
        and mark each one as you go. Anyone with this link sees the same list.
      </p>

      {/* Progress */}
      <div className={`mt-5 rounded-2xl p-4 ${p.complete ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-200'}`}>
        {p.complete ? (
          <p className="flex items-center gap-2 font-bold text-green-700"><Check className="w-5 h-5" /> Everything is at the house — thank you!</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-[#2C2C2A]">{p.atHouse} of {p.total} at the house</span>
              <span className="text-sm text-gray-500">{pct}%</span>
            </div>
            <div className="mt-2 h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              {p.ordered > 0 && <>{p.ordered} ordered{p.lastArrival ? ` (last one arrives ${prettyDay(p.lastArrival)})` : ''} · </>}
              {p.notPurchased} not purchased yet
            </p>
          </>
        )}
      </div>


      {/* Items */}
      <ul className="mt-4 space-y-3">
        {items.map((it) => {
          const st = STATUS_STYLE[it.status] || STATUS_STYLE.not_purchased;
          const late = it.status === 'ordered' && it.arrives_on && it.arrives_on < todayKey();
          return (
            <li key={it.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-[16px] text-[#2C2C2A]">{it.label}</p>
                  {it.note && <p className="mt-0.5 text-sm text-gray-600 whitespace-pre-line">{it.note}</p>}
                </div>
                {saving === it.id
                  ? <Loader2 className="w-5 h-5 animate-spin text-gray-400 flex-shrink-0" />
                  : <span className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-full ${st.chip}`}>{STATUSES.find((s) => s.value === it.status)?.short}</span>}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label={`Status for ${it.label}`}>
                {STATUSES.map((s) => {
                  const S = STATUS_STYLE[s.value];
                  const Icon = S.icon;
                  const on = it.status === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      disabled={preview || saving === it.id}
                      onClick={() => !on && change(it, { status: s.value, arrives_on: s.value === 'ordered' ? it.arrives_on : null })}
                      className={`min-h-[44px] px-1.5 rounded-xl border text-[13px] font-semibold flex items-center justify-center gap-1.5 transition ${on ? S.on : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'} disabled:opacity-60`}
                      aria-pressed={on}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" /> <span className="leading-tight">{s.short}</span>
                    </button>
                  );
                })}
              </div>

              {it.status === 'ordered' && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="text-sm text-gray-700 flex items-center gap-2">
                    Arrives on
                    <input
                      type="date"
                      value={it.arrives_on || ''}
                      disabled={preview || saving === it.id}
                      onChange={(e) => change(it, { status: 'ordered', arrives_on: e.target.value || null })}
                      className="h-10 px-2 rounded-lg border border-gray-300 text-base"
                    />
                  </label>
                  <label className="text-sm text-gray-600 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!it.arrives_on && it.arrival_unknown}
                      disabled={preview || saving === it.id}
                      onChange={(e) => change(it, { status: 'ordered', arrives_on: null, arrival_unknown: e.target.checked })}
                      className="w-4 h-4"
                    />
                    Don't know yet
                  </label>
                  {late && (
                    <span className="text-sm font-semibold text-red-600 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> Delivery date passed — is it at the house?
                    </span>
                  )}
                </div>
              )}

              {it.updated_by_kind && (
                <p className="mt-2 text-xs text-gray-400">Updated · {when(it.updated_at)}</p>
              )}
            </li>
          );
        })}
      </ul>

      {(list.notices || []).length > 0 && (
        <div className="mt-5 rounded-2xl bg-[#FFF5EC] border border-[#F7D3B5] p-4 text-sm text-[#5a4a3c]">
          <p className="font-bold">Please note</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {list.notices.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}

    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#f5f5f3] px-4 py-6 sm:py-10">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <img src={logo} alt="Omega Development" className="w-12 h-12 object-contain" />
          <div>
            <div className="text-[19px] font-black tracking-tight text-[#2C2C2A]">OMEGA<span style={{ color: ORANGE }}>DEVELOPMENT</span></div>
            <div className="text-[10px] font-semibold tracking-[.18em] text-gray-500">RENOVATIONS &amp; CONSTRUCTION</div>
          </div>
        </div>
        {children}
        <div className="mt-8 pt-4 border-t border-gray-200 text-center text-sm text-gray-500 leading-relaxed">
          Please don't reply to the text or email. Questions? Call or text us at{' '}
          <a href="tel:+12034514846" className="font-semibold text-gray-700 inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{OFFICE_PHONE}</a>.
          <div className="mt-1 text-xs">Omega Development LLC · omeganyct.com</div>
        </div>
      </div>
    </div>
  );
}
