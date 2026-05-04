import { useEffect, useMemo, useState } from 'react';
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2,
  Trash2, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toE164 } from '../../../shared/lib/phone';
import { logAudit } from '../../../shared/lib/audit';
import {
  SERVICES, LEAD_SOURCES, LEAD_STATUSES,
} from '../../receptionist/lib/leadCatalog';

// ─────────────────────────────────────────────────────────────────
// ImportLeads — bulk-import an old leads CSV from Google Sheets.
//
// All imported rows land with in_pipeline=false so Attila's kanban
// stays clean. Rafa can selectively flip them on later from My Leads.
//
// Expected column order (matches Ramon's spreadsheet header row):
//   DATE | SOURCE | EMAIL | ADDRESS | PHONE | NAME | PROJECT |
//   APPT DATE | STATUS | LAST TOUCH | INFO/NOTES
//
// The parser is tolerant: header order is detected from the first
// row's labels, so a renamed/reordered sheet still works as long as
// the column names start with the canonical prefix.
// ─────────────────────────────────────────────────────────────────

// Column key → list of header prefixes that should resolve to it.
// All comparisons are lowercase + trim.
const COLUMN_PREFIXES = {
  date:    ['date'],
  source:  ['source'],
  email:   ['email'],
  address: ['address'],
  phone:   ['phone', 'phone #', 'phone#'],
  name:    ['name', 'client', 'client name'],
  project: ['project', 'service'],
  appt:    ['appt', 'appointment'],
  status:  ['status'],
  touch:   ['last touch', 'last t', 'last contact'],
  notes:   ['info', 'notes', 'info/notes', 'info / notes'],
};

function detectColumnIndex(header, key) {
  const prefixes = COLUMN_PREFIXES[key] || [];
  for (let i = 0; i < header.length; i++) {
    const h = (header[i] || '').toLowerCase().trim();
    if (!h) continue;
    for (const p of prefixes) {
      if (h === p || h.startsWith(p)) return i;
    }
  }
  return -1;
}

// Tiny, dependency-free CSV parser. Handles double-quoted fields,
// escaped quotes (""), commas inside quotes, and CRLF / LF line
// endings. Good enough for well-formed Google Sheets exports —
// which is what Ramon will produce.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    // Not in quotes
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += ch;
    i += 1;
  }
  // Trailing cell
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop trailing fully-empty row (CSVs often end with a newline).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) {
    rows.pop();
  }
  return rows;
}

// Convert "12/22/26" / "12/22/2026" / "2026-12-22" / Excel date number
// to YYYY-MM-DD. Returns null if unparseable.
function normalizeDate(raw) {
  const s = (raw || '').trim();
  if (!s) return null;

  // Already ISO?
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;

  // MM/DD/YY or MM/DD/YYYY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2, '0');
    const dd = String(m[2]).padStart(2, '0');
    let yy = m[3];
    if (yy.length === 2) yy = String(2000 + Number(yy));
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

// Match a free-text source value against the canonical LEAD_SOURCES
// list. Falls back to capitalized input when no match.
function normalizeSource(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const hit = LEAD_SOURCES.find((opt) => opt.toLowerCase() === lower);
  if (hit) return hit;
  // Capitalize fallback so "google" still reads "Google" in the UI.
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Match a free-text project against SERVICES values OR labels.
function normalizeService(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const hit = SERVICES.find((opt) =>
    opt.value.toLowerCase() === lower || opt.label.toLowerCase() === lower
  );
  return hit ? hit.value : lower; // unmatched: lowercase free-text is OK
}

// Match a free-text status against LEAD_STATUSES values OR labels.
function normalizeStatus(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const hit = LEAD_STATUSES.find((opt) =>
    opt.value === lower || opt.label.toLowerCase() === lower
  );
  return hit ? hit.value : null;
}

export default function ImportLeads({ user }) {
  const [fileName, setFileName]     = useState('');
  const [parsing, setParsing]       = useState(false);
  const [error, setError]           = useState('');
  const [rows, setRows]             = useState([]);          // parsed + normalized rows
  const [duplicatesByPhone, setDuplicatesByPhone] = useState(new Set());
  const [importing, setImporting]   = useState(false);
  const [result, setResult]         = useState(null);        // { inserted, skipped }
  const [staff, setStaff]           = useState([]);
  const [defaultOwner, setDefaultOwner] = useState('');

  // Active staff list — drives the "Default Lead Owner" select.
  // Defaults to nobody so the import is honest about cold leads;
  // Rafa can re-assign per-row later.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('name, role, active')
          .eq('active', true)
          .neq('role', 'admin')
          .order('name', { ascending: true });
        if (active) setStaff(data || []);
      } catch { if (active) setStaff([]); }
    })();
    return () => { active = false; };
  }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    setResult(null);
    setRows([]);
    setDuplicatesByPhone(new Set());
    setParsing(true);

    try {
      const text = await file.text();
      const grid = parseCSV(text);
      if (grid.length < 2) throw new Error('CSV is empty or has no data rows.');

      const header = grid[0];
      const idx = {
        date:    detectColumnIndex(header, 'date'),
        source:  detectColumnIndex(header, 'source'),
        email:   detectColumnIndex(header, 'email'),
        address: detectColumnIndex(header, 'address'),
        phone:   detectColumnIndex(header, 'phone'),
        name:    detectColumnIndex(header, 'name'),
        project: detectColumnIndex(header, 'project'),
        appt:    detectColumnIndex(header, 'appt'),
        status:  detectColumnIndex(header, 'status'),
        touch:   detectColumnIndex(header, 'touch'),
        notes:   detectColumnIndex(header, 'notes'),
      };

      const required = ['name', 'phone'];
      const missing = required.filter((k) => idx[k] === -1);
      if (missing.length) {
        throw new Error(`Couldn't find required column(s): ${missing.join(', ')}. Check the header row.`);
      }

      const parsed = grid.slice(1).map((cells, rowIdx) => {
        const get = (k) => idx[k] === -1 ? '' : (cells[idx[k]] || '');
        const phoneE164 = toE164(get('phone')) || (get('phone') || '').trim();
        return {
          _rowIdx: rowIdx,
          lead_date:            normalizeDate(get('date')),
          lead_source:          normalizeSource(get('source')),
          client_email:         get('email').trim() || null,
          address:              get('address').trim() || null,
          client_phone:         phoneE164 || null,
          client_name:          get('name').trim() || null,
          service:              normalizeService(get('project')),
          preferred_visit_date: normalizeDate(get('appt')),
          lead_status:          normalizeStatus(get('status')),
          last_touch_note:      [get('touch'), get('notes')].map((s) => s.trim()).filter(Boolean).join(' / ') || null,
        };
      }).filter((r) => r.client_name || r.client_phone); // drop blank rows

      // Dedup against the existing jobs table — by phone (E.164).
      const phones = parsed.map((r) => r.client_phone).filter(Boolean);
      const dupSet = new Set();
      if (phones.length) {
        // Chunk to keep the .in() filter url-safe.
        for (let i = 0; i < phones.length; i += 200) {
          const slice = phones.slice(i, i + 200);
          const { data } = await supabase
            .from('jobs')
            .select('client_phone')
            .in('client_phone', slice);
          for (const row of (data || [])) {
            if (row.client_phone) dupSet.add(row.client_phone);
          }
        }
      }

      setRows(parsed);
      setDuplicatesByPhone(dupSet);
    } catch (err) {
      setError(err?.message || 'Failed to parse CSV.');
    } finally {
      setParsing(false);
    }
  }

  function clearFile() {
    setFileName('');
    setRows([]);
    setDuplicatesByPhone(new Set());
    setError('');
    setResult(null);
  }

  async function runImport() {
    if (rows.length === 0) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      // Skip duplicates by phone.
      const fresh = rows.filter((r) => !r.client_phone || !duplicatesByPhone.has(r.client_phone));
      const skipped = rows.length - fresh.length;

      // Strip the helper field + add defaults.
      const payload = fresh.map((r) => ({
        lead_date:            r.lead_date,
        client_name:          r.client_name,
        client_phone:         r.client_phone,
        client_email:         r.client_email,
        address:              r.address,
        service:              r.service,
        lead_source:          r.lead_source,
        preferred_visit_date: r.preferred_visit_date,
        lead_status:          r.lead_status,
        last_touch_note:      r.last_touch_note,
        lead_owner:           defaultOwner || null,
        // Cold leads — explicitly off the kanban.
        in_pipeline:          false,
        pipeline_status:      'new_lead',
        status:               'new_lead',
        created_by:           'import',
      }));

      let inserted = 0;
      // Chunked insert so we don't blow request size limits.
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        const { data, error: e } = await supabase.from('jobs').insert(chunk).select('id');
        if (e) throw e;
        inserted += (data || []).length;
      }

      logAudit({
        user, action: 'leads.bulk_import', entityType: 'job',
        details: { inserted, skipped, source_file: fileName },
      });

      setResult({ inserted, skipped });
      // Reset rows to prevent re-import; keep the result panel.
      setRows([]);
      setDuplicatesByPhone(new Set());
    } catch (err) {
      setError(err?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  const totalRows = rows.length;
  const dupCount  = useMemo(
    () => rows.filter((r) => r.client_phone && duplicatesByPhone.has(r.client_phone)).length,
    [rows, duplicatesByPhone]
  );
  const importable = totalRows - dupCount;

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-5">
        <header>
          <h1 className="text-2xl font-black text-omega-charcoal inline-flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-omega-orange" /> Import Old Leads
          </h1>
          <p className="text-sm text-omega-stone mt-1">
            Upload a CSV exported from Google Sheets. All rows land with the pipeline toggle
            <strong> off</strong> — they're invisible to Attila until promoted from My Leads.
          </p>
        </header>

        {/* Step 1 — pick file */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-omega-orange text-white inline-flex items-center justify-center text-xs font-bold">1</span>
              <h2 className="text-base font-bold text-omega-charcoal">Upload CSV</h2>
            </div>
            {fileName && (
              <button
                onClick={clearFile}
                className="inline-flex items-center gap-1 text-xs font-bold text-omega-stone hover:text-red-600"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          <label className="block">
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} className="hidden" />
            <span className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed border-gray-300 hover:border-omega-orange hover:bg-omega-pale/30 cursor-pointer transition-colors">
              <Upload className="w-5 h-5 text-omega-orange" />
              <span className="text-sm font-bold text-omega-charcoal">
                {fileName || 'Click to choose a CSV file'}
              </span>
            </span>
          </label>

          {parsing && (
            <p className="inline-flex items-center gap-2 text-xs text-omega-stone">
              <Loader2 className="w-3 h-3 animate-spin" /> Parsing…
            </p>
          )}

          <details className="text-xs text-omega-stone">
            <summary className="cursor-pointer font-bold inline-flex items-center gap-1">
              <Info className="w-3 h-3" /> Expected columns
            </summary>
            <p className="mt-1.5">
              The header row should include (in any order):
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">DATE</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">SOURCE</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">EMAIL</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">ADDRESS</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">PHONE</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">NAME</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">PROJECT</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">APPT DATE</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">STATUS</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">LAST TOUCH</code>,
              <code className="bg-omega-cloud px-1 mx-0.5 rounded">INFO / NOTES</code>.
              Only NAME and PHONE are required.
            </p>
          </details>
        </section>

        {/* Step 2 — defaults + preview */}
        {rows.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-5 space-y-4">
            <div className="inline-flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-omega-orange text-white inline-flex items-center justify-center text-xs font-bold">2</span>
              <h2 className="text-base font-bold text-omega-charcoal">Review & Import</h2>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Rows in file"   value={totalRows} />
              <Stat label="Duplicates (skip)" value={dupCount} tone="amber" />
              <Stat label="Will import"    value={importable} tone="green" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">
                  Default Lead Owner <span className="text-omega-stone font-normal normal-case">(applied to every row)</span>
                </label>
                <select
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-omega-orange outline-none"
                  value={defaultOwner}
                  onChange={(e) => setDefaultOwner(e.target.value)}
                >
                  <option value="">— Leave blank —</option>
                  {staff.map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.name}{u.role ? ` · ${u.role}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview table — first 20 rows */}
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs min-w-[1000px]">
                <thead className="bg-omega-cloud">
                  <tr>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Email</Th>
                    <Th>Address</Th>
                    <Th>Service</Th>
                    <Th>Source</Th>
                    <Th>Status</Th>
                    <Th>Lead Date</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => {
                    const isDup = r.client_phone && duplicatesByPhone.has(r.client_phone);
                    return (
                      <tr key={i} className={`border-b border-gray-100 ${isDup ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-2 py-1.5 font-semibold text-omega-charcoal whitespace-nowrap">
                          {r.client_name || <span className="text-omega-stone italic">—</span>}
                          {isDup && <span className="ml-1.5 text-[9px] font-bold text-amber-700">DUP</span>}
                        </td>
                        <td className="px-2 py-1.5 text-omega-slate whitespace-nowrap">{r.client_phone || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate truncate max-w-[180px]">{r.client_email || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate truncate max-w-[180px]">{r.address || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate">{r.service || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate">{r.lead_source || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate">{r.lead_status || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate whitespace-nowrap">{r.lead_date || '—'}</td>
                        <td className="px-2 py-1.5 text-omega-slate truncate max-w-[200px]">{r.last_touch_note || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 20 && (
              <p className="text-[11px] text-omega-stone">+ {rows.length - 20} more rows not shown.</p>
            )}

            <button
              onClick={runImport}
              disabled={importing || importable === 0}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white font-bold text-sm shadow-sm"
            >
              {importing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</>
                : <><Upload className="w-4 h-4" /> Import {importable} lead{importable === 1 ? '' : 's'}</>
              }
            </button>
          </section>
        )}

        {/* Result */}
        {result && (
          <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <div className="inline-flex items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-emerald-900">Import complete.</h3>
            </div>
            <p className="text-sm text-emerald-900">
              <strong>{result.inserted}</strong> lead{result.inserted === 1 ? '' : 's'} added — all with the pipeline toggle off.
              {result.skipped > 0 && <> Skipped <strong>{result.skipped}</strong> duplicate{result.skipped === 1 ? '' : 's'} (already in My Leads by phone).</>}
            </p>
          </section>
        )}

        {error && (
          <section className="bg-red-50 border border-red-200 rounded-2xl p-4 inline-flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-2 py-1.5 text-left border-b border-gray-200 text-[10px] font-bold uppercase tracking-wider text-omega-stone">
      {children}
    </th>
  );
}

function Stat({ label, value, tone = 'gray' }) {
  const cls = tone === 'amber'
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : tone === 'green'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : 'bg-omega-cloud border-gray-200 text-omega-charcoal';
  return (
    <div className={`px-3 py-2 rounded-xl border ${cls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-black tabular-nums leading-none mt-0.5">{value}</p>
    </div>
  );
}
