// Client purchase lists (migration 088) — the things the CLIENT buys before a
// bathroom / kitchen / renovation job starts.
//
// Flow: contract signed → the app drafts the list from the default template
// (api/docusign-webhook → api/_lib/purchaseLists.js, or the "Create list"
// button) → Attila reviews it and sends it (SMS + email, server side) → the
// client marks each item on the public page /purchase-list/:id → the team
// sees the progress on the Phases tab and gets a 3pm WhatsApp digest.
//
// The server keeps its own copy of the template/eligibility rules in
// api/_lib/purchaseLists.js — keep both in step.

import { supabase } from './supabase';
import { parseJobServices } from '../data/services';

export const STATUSES = [
  { value: 'not_purchased', label: 'Not purchased yet', short: 'Not purchased' },
  { value: 'ordered',       label: 'Ordered',           short: 'Ordered' },
  { value: 'at_house',      label: 'At the house',      short: 'At the house' },
];
export const statusLabel = (s) => STATUSES.find((x) => x.value === s)?.label || 'Not purchased yet';

// Attila, Inácio and Rafaela edit lists and the default template (+ admin).
export const CAN_EDIT_PURCHASE = new Set(['sales', 'salesperson', 'owner', 'operations', 'admin']);

// Which default lists a job gets: bathroom → bathroom, kitchen → kitchen,
// a renovation → both (Attila removes what doesn't apply).
export function purchaseServices(job) {
  const ids = parseJobServices(job?.service);
  const out = new Set();
  for (const id of ids) {
    if (id === 'bathroom') out.add('bathroom');
    else if (id === 'kitchen') out.add('kitchen');
    else if (id === 'partialreno' || id === 'fullreno') { out.add('bathroom'); out.add('kitchen'); }
  }
  return [...out];
}

export const isPurchaseEligible = (job) => purchaseServices(job).length > 0;

export function purchaseLink(listId) {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://omega-unified.vercel.app';
  return `${base}/purchase-list/${listId}`;
}

// { total, atHouse, ordered, notPurchased, overdue, lastArrival, complete }
export function listProgress(items, todayKey = new Date().toISOString().slice(0, 10)) {
  const p = { total: items.length, atHouse: 0, ordered: 0, notPurchased: 0, overdue: 0, lastArrival: null };
  for (const it of items) {
    if (it.status === 'at_house') p.atHouse++;
    else if (it.status === 'ordered') {
      p.ordered++;
      if (it.arrives_on) {
        if (it.arrives_on < todayKey) p.overdue++;
        if (!p.lastArrival || it.arrives_on > p.lastArrival) p.lastArrival = it.arrives_on;
      }
    } else p.notPurchased++;
  }
  p.complete = p.total > 0 && p.atHouse === p.total;
  return p;
}

export async function loadPurchaseList(jobId) {
  const { data: list, error } = await supabase.from('purchase_lists').select('*').eq('job_id', jobId).maybeSingle();
  if (error) throw error;
  if (!list) return { list: null, items: [] };
  const { data: items, error: e2 } = await supabase.from('purchase_list_items')
    .select('*').eq('list_id', list.id).order('position', { ascending: true });
  if (e2) throw e2;
  return { list, items: items || [] };
}

export async function loadTemplates() {
  const { data, error } = await supabase.from('purchase_list_templates')
    .select('*').order('service').order('kind').order('position');
  if (error) throw error;
  return data || [];
}

// Draft a list for the job from the default templates. Items repeated across
// services (light fixtures, window shades) appear once.
export async function createDraftList(job) {
  const services = purchaseServices(job);
  const tpl = (await loadTemplates()).filter((t) => services.includes(t.service));
  const seen = new Set();
  const items = [];
  const notices = [];
  for (const svc of services) {
    for (const t of tpl.filter((x) => x.service === svc)) {
      const key = t.label.trim().toLowerCase();
      if (seen.has(`${t.kind}:${key}`)) continue;
      seen.add(`${t.kind}:${key}`);
      if (t.kind === 'notice') notices.push(t.label.trim());
      else items.push({ label: t.label.trim(), note: t.note || null });
    }
  }
  const { data: list, error } = await supabase.from('purchase_lists')
    .insert([{ job_id: job.id, services, notices }]).select().single();
  if (error) throw error;
  if (items.length) {
    const { error: e2 } = await supabase.from('purchase_list_items')
      .insert(items.map((it, i) => ({ ...it, list_id: list.id, position: i + 1 })));
    if (e2) throw e2;
  }
  return loadPurchaseList(job.id);
}

// Change one item's status (client page or team). Logs the change and keeps
// the list's status in step (complete when every item is at the house).
// by = { name, kind: 'client' | 'team' }
export async function setItemStatus(item, { status, arrives_on = null, arrival_unknown = false }, by, list) {
  const patch = {
    status,
    arrives_on: status === 'ordered' ? (arrives_on || null) : null,
    arrival_unknown: status === 'ordered' ? !!arrival_unknown && !arrives_on : false,
    updated_by: by?.name || null,
    updated_by_kind: by?.kind || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('purchase_list_items').update(patch).eq('id', item.id).select().single();
  if (error) throw error;
  await supabase.from('purchase_list_events').insert([{
    list_id: item.list_id, job_id: list?.job_id || null, item_id: item.id, item_label: item.label,
    from_status: item.status, to_status: status, arrives_on: patch.arrives_on,
    by_name: by?.name || null, by_kind: by?.kind || null,
  }]);
  await syncListStatus(item.list_id);
  return data;
}

// Recompute complete / sent after any change (fresh from the db — the page
// may hold an old copy of the list). Drafts stay drafts.
export async function syncListStatus(listId) {
  const [{ data: l }, { data: items }] = await Promise.all([
    supabase.from('purchase_lists').select('status').eq('id', listId).maybeSingle(),
    supabase.from('purchase_list_items').select('status').eq('list_id', listId),
  ]);
  const status = l?.status;
  if (!status || status === 'draft') return;
  const complete = (items || []).length > 0 && items.every((i) => i.status === 'at_house');
  const next = complete ? 'complete' : 'sent';
  if (next === status) return;
  await supabase.from('purchase_lists').update({
    status: next, completed_at: complete ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }).eq('id', listId);
}
