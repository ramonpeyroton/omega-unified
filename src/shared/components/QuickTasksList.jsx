import { useEffect, useRef, useState } from 'react';
import { CheckSquare, Square, Trash2, Plus, Loader2, ListChecks } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Personal "quick tasks" scratchpad for a single user. Rows live in
 * `user_tasks` keyed by `user_name`. Looks like a notebook checklist:
 * each line editable inline, Enter adds a new line, checkbox toggles
 * done (with strike-through), backspace on empty line removes it.
 *
 * Design rules:
 *   - No job association — purely personal day-of items for this user.
 *   - Done items show at the bottom, crossed out, still editable.
 *   - Writes debounced so typing doesn't pound the database.
 */
const DEBOUNCE_MS = 500;

export default function QuickTasksList({ user }) {
  const [rows, setRows]         = useState([]);   // [{id, body, done}]
  const [loading, setLoading]   = useState(true);
  const [focused, setFocused]   = useState(null); // id being edited
  const debouncers              = useRef({});
  const inputRefs               = useRef({});

  // Tasks are scoped to the ROLE (manager/owner/operations/…) rather
  // than the typed name, because the app has no real auth yet — any
  // typo on the login name used to create a second invisible bucket.
  // When proper Supabase Auth lands, swap this to user.id.
  const ownerRole = user?.role || null;

  useEffect(() => { if (ownerRole) load(); /* eslint-disable-next-line */ }, [ownerRole]);

  async function load() {
    setLoading(true);
    try {
      // Sort purely by insertion order so tablet / PC always show the
      // same arrangement after reload. We re-sort client-side as a
      // belt-and-suspenders because some Supabase clients will drop
      // ordering if a cache hint is in play, and we add `id` as a
      // deterministic tiebreaker in case two rows share a timestamp.
      const { data } = await supabase
        .from('user_tasks')
        .select('*')
        .eq('user_role', ownerRole)
        .order('created_at', { ascending: true })
        .order('id',         { ascending: true });
      const sorted = (data || []).slice().sort((a, b) => {
        const ca = a?.created_at || '';
        const cb = b?.created_at || '';
        if (ca !== cb) return ca < cb ? -1 : 1;
        return String(a.id).localeCompare(String(b.id));
      });
      setRows(sorted);
    } catch { setRows([]); }
    setLoading(false);
  }

  async function insertRow(afterId = null) {
    try {
      const { data } = await supabase.from('user_tasks').insert([{
        user_name: user?.name || null,
        user_role: ownerRole,
        body: '',
      }]).select().single();
      if (!data) return;
      setRows((prev) => {
        if (!afterId) return [...prev, data];
        const idx = prev.findIndex((r) => r.id === afterId);
        if (idx < 0) return [...prev, data];
        const next = [...prev];
        next.splice(idx + 1, 0, data);
        return next;
      });
      // Focus the new row on the next tick
      setTimeout(() => inputRefs.current[data.id]?.focus(), 10);
    } catch { /* ignore */ }
  }

  function scheduleWrite(id, patch) {
    clearTimeout(debouncers.current[id]);
    debouncers.current[id] = setTimeout(async () => {
      try {
        await supabase.from('user_tasks').update(patch).eq('id', id);
      } catch { /* ignore */ }
    }, DEBOUNCE_MS);
  }

  function updateBody(id, body) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, body } : r));
    scheduleWrite(id, { body });
  }

  async function toggleDone(row) {
    const next = !row.done;
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, done: next } : r));
    try {
      await supabase.from('user_tasks').update({
        done: next,
        done_at: next ? new Date().toISOString() : null,
      }).eq('id', row.id);
    } catch { /* ignore */ }
  }

  async function deleteRow(row) {
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try { await supabase.from('user_tasks').delete().eq('id', row.id); } catch { /* ignore */ }
  }

  async function clearDone() {
    const doneRows = rows.filter((r) => r.done);
    if (!doneRows.length) return;
    if (!confirm(`Clear ${doneRows.length} completed task${doneRows.length === 1 ? '' : 's'}?`)) return;
    setRows((prev) => prev.filter((r) => !r.done));
    try {
      await supabase.from('user_tasks').delete()
        .eq('user_role', ownerRole).eq('done', true);
    } catch { /* ignore */ }
  }

  function onKeyDown(e, row, idx) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertRow(row.id);
    } else if (e.key === 'Backspace' && !row.body) {
      e.preventDefault();
      deleteRow(row);
      const prevRow = rows[idx - 1];
      if (prevRow) setTimeout(() => inputRefs.current[prevRow.id]?.focus(), 10);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      toggleDone(row);
    }
  }

  const openCount = rows.filter((r) => !r.done).length;
  const doneCount = rows.length - openCount;

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-amber-50/60 border-b border-amber-100">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-bold text-omega-charcoal tracking-tight">To Do List</h2>
          <span className="text-[10px] font-bold text-amber-700 bg-white/70 px-2 py-0.5 rounded-full">
            {openCount}{doneCount > 0 ? ` · ${doneCount} done` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {doneCount > 0 && (
            <button
              onClick={clearDone}
              className="text-[11px] font-bold text-omega-stone hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
            >
              Clear done
            </button>
          )}
          <button
            onClick={() => insertRow()}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold"
            title="Add new task (or press Enter on any line)"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>
      <div className="p-4 sm:p-5">

      {loading && <p className="text-xs text-omega-stone">Loading…</p>}

      {!loading && rows.length === 0 && (
        <button
          onClick={() => insertRow()}
          className="w-full py-8 text-center text-sm text-omega-stone border-2 border-dashed border-gray-200 rounded-xl hover:border-omega-orange hover:text-omega-orange transition-colors"
        >
          <Plus className="w-4 h-4 inline-block mr-1 -mt-0.5" />
          Start your list — tap to add the first task
        </button>
      )}

      <ul className="space-y-0.5">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-start gap-2 py-1">
            <button
              onClick={() => toggleDone(r)}
              className={`mt-0.5 p-1.5 rounded flex items-center justify-center flex-shrink-0 transition-colors`}
              title={r.done ? 'Mark as open' : 'Mark as done'}
            >
              <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                r.done
                  ? 'bg-omega-success border-omega-success'
                  : 'border-gray-300'
              }`}>
              {r.done && <CheckSquare className="w-3 h-3 text-white" strokeWidth={3} />}
              </span>
            </button>
            <input
              ref={(el) => { if (el) inputRefs.current[r.id] = el; }}
              value={r.body}
              onChange={(e) => updateBody(r.id, e.target.value)}
              onKeyDown={(e) => onKeyDown(e, r, i)}
              onFocus={() => setFocused(r.id)}
              onBlur={() => setFocused(null)}
              placeholder="Write a task…"
              className={`flex-1 min-w-0 bg-transparent border-0 outline-none focus-visible:ring-1 focus-visible:ring-omega-orange rounded text-[15px] py-1 leading-snug ${
                r.done
                  ? 'line-through text-omega-stone'
                  : 'text-omega-charcoal placeholder-omega-stone/50'
              }`}
            />
            {/* Always-visible delete button (one tap on mobile, no hover needed) */}
            <button
              onClick={() => deleteRow(r)}
              className="mt-0.5 p-2 rounded-lg text-omega-stone hover:text-white hover:bg-red-500 transition-colors flex-shrink-0"
              title="Delete task"
              aria-label="Delete task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      {rows.length > 0 && (
        <p className="text-[10px] text-omega-stone/70 mt-3 font-semibold">
          Enter to add · Backspace on empty line to remove · ⌘⏎ to toggle done
        </p>
      )}
      </div>
    </div>
  );
}
