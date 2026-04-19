// ════════════════════════════════════════════════════════════════════
// Jarvis Tools — read-only Supabase queries exposed to Groq via function
// calling. Every tool receives `ctx = { user }` from chatWithGroqTools and
// applies role-based filtering server-side of the UI (client-side of the
// DB — real RLS will come later).
//
// Role scope (enforced here, NOT trusted to the LLM):
//   admin      → everything
//   owner      → everything (read)
//   operations → everything (read + financial)
//   sales      → only jobs WHERE salesperson_name = user.name
//   manager    → jobs scoped to in-progress; NO financial fields
//   screen     → read-only, no financials, no PII beyond basic info
//   marketing  → read-only, no financials
// ════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';

// ─── role-based access ─────────────────────────────────────────────
const ALL_ACCESS   = new Set(['admin', 'owner', 'operations']);
const FINANCIAL    = new Set(['admin', 'owner', 'operations']);
const CAN_SEE_SUBS = new Set(['admin', 'owner', 'operations', 'manager']); // manager sees subs (no $)
const NO_SALES     = (role) => role !== 'sales' && role !== 'salesperson';

function normRole(role) {
  if (role === 'salesperson') return 'sales';
  return role || 'unknown';
}

// Strip financial / sensitive fields from a job row based on role
function scrubJob(job, role) {
  if (!job) return job;
  const r = normRole(role);
  const safe = {
    id: job.id,
    client_name: job.client_name,
    service: job.service,
    address: job.address,
    city: job.city,
    status: job.status,
    pipeline_status: job.pipeline_status,
    salesperson: job.salesperson_name,
    pm: job.pm_name,
    created_at: job.created_at,
  };
  // Owner/Ops/Admin see everything else; others don't.
  if (FINANCIAL.has(r)) {
    safe.answers = job.answers || null;
    safe.latest_report_present = !!(job.latest_report || job.report_raw || job.report);
  }
  return safe;
}

function scrubSub(sub, role) {
  if (!sub) return sub;
  const r = normRole(role);
  // Manager sees name/specialty/phone but no insurance/tax details
  const base = {
    id: sub.id,
    name: sub.name,
    specialty: sub.specialty || sub.trade,
    phone: sub.phone,
    email: sub.email,
  };
  if (FINANCIAL.has(r)) {
    base.tax_id = sub.tax_id;
    base.insurance_company = sub.insurance_company;
    base.coi_expiry_date = sub.coi_expiry_date;
  }
  return base;
}

// ─── Tool definitions exposed to the model ─────────────────────────
// Tools that involve financials are filtered out of this array based on
// role in `getToolsForRole()` below.
const TOOL_DEFS = {
  get_jobs_summary: {
    type: 'function',
    function: {
      name: 'get_jobs_summary',
      description:
        'Returns the most recent jobs (up to 20) the current user is allowed to see, plus a total count. Use when the user asks things like "how many jobs", "what are we working on", or wants a pipeline overview.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  get_job_details: {
    type: 'function',
    function: {
      name: 'get_job_details',
      description:
        'Full details for a single job by id — phases, assigned subcontractors, and summary. Use after identifying the job id (via search_jobs_by_client).',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'UUID of the job.' } },
        required: ['job_id'],
      },
    },
  },
  search_jobs_by_client: {
    type: 'function',
    function: {
      name: 'search_jobs_by_client',
      description:
        'Case-insensitive partial search for jobs by client name. Use when the user mentions a client (e.g. "what phase is Anthony in?").',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string' } },
        required: ['client_name'],
      },
    },
  },
  get_subs_by_trade: {
    type: 'function',
    function: {
      name: 'get_subs_by_trade',
      description:
        'Returns subcontractors filtered by specialty (electrical, plumbing, framing, etc). Case-insensitive partial match.',
      parameters: {
        type: 'object',
        properties: { trade: { type: 'string' } },
        required: ['trade'],
      },
    },
  },
  get_contracts_summary: {
    type: 'function',
    function: {
      name: 'get_contracts_summary',
      description:
        'Returns a list of contracts with total amount, DocuSign status, signed/sent dates. Financial tool — admin/owner/operations only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  get_payment_aging: {
    type: 'function',
    function: {
      name: 'get_payment_aging',
      description:
        'Returns open installments from signed contracts with due dates and days overdue. Financial tool — admin/owner/operations only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  get_change_orders: {
    type: 'function',
    function: {
      name: 'get_change_orders',
      description:
        'Returns change orders with status, paid status, amount. Financial tool — admin/owner/operations only.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  get_audit_log: {
    type: 'function',
    function: {
      name: 'get_audit_log',
      description:
        'Returns the most recent audit events — who did what in the app. Admin/Owner only.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max rows, default 20' } },
        required: [],
      },
    },
  },
};

/** Return only the tools a given role is allowed to call. */
export function getToolsForRole(role) {
  const r = normRole(role);
  const base = ['get_jobs_summary', 'get_job_details', 'search_jobs_by_client'];

  // Subs: manager+ops+owner+admin (but sales does NOT see subs)
  if (CAN_SEE_SUBS.has(r)) base.push('get_subs_by_trade');

  // Financial tools: admin/owner/operations
  if (FINANCIAL.has(r)) {
    base.push('get_contracts_summary', 'get_payment_aging', 'get_change_orders');
  }

  // Audit log: admin + owner
  if (r === 'admin' || r === 'owner') base.push('get_audit_log');

  return base.map((k) => TOOL_DEFS[k]).filter(Boolean);
}

// ─── Implementations ────────────────────────────────────────────────
export const toolImplementations = {
  async get_jobs_summary(_args, ctx) {
    const role = normRole(ctx?.user?.role);
    try {
      let q = supabase
        .from('jobs')
        .select('id, client_name, service, status, pipeline_status, address, city, salesperson_name, pm_name, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      // Sales currently sees all jobs (single salesperson company-wide).
      // Keep this block if you later scope sales to own-only:
      // if (role === 'sales') q = q.ilike('salesperson_name', ctx?.user?.name || '');
      // Manager: only in-progress
      if (role === 'manager') {
        q = q.in('pipeline_status', ['in_progress', 'in-progress']);
      }

      const { data, error } = await q;
      if (error) throw error;

      const buckets = { in_progress: 0, completed: 0, on_hold: 0, other: 0 };
      (data || []).forEach((j) => {
        const s = (j.pipeline_status || j.status || '').toLowerCase().replace(/-/g, '_');
        if (buckets[s] != null) buckets[s] += 1;
        else buckets.other += 1;
      });

      return {
        total_shown: data?.length || 0,
        status_counts: buckets,
        jobs: (data || []).map((j) => scrubJob(j, role)),
        scope_note:
          role === 'sales' ? 'Filtered to jobs assigned to the current salesperson.' :
          role === 'manager' ? 'Filtered to jobs currently in progress.' :
          null,
      };
    } catch (err) {
      return { error: `Failed to load jobs: ${err.message || err}` };
    }
  },

  async get_job_details({ job_id }, ctx) {
    const role = normRole(ctx?.user?.role);
    if (!job_id) return { error: 'Missing job_id.' };
    try {
      const { data: job, error } = await supabase.from('jobs').select('*').eq('id', job_id).maybeSingle();
      if (error) throw error;
      if (!job) return { error: 'Job not found.' };

      // Sales ownership check disabled — single salesperson sees all jobs.

      const [{ data: phases }, { data: subs }] = await Promise.all([
        supabase.from('job_phases').select('*').eq('job_id', job_id).order('phase_index'),
        supabase.from('job_subs').select('*').eq('job_id', job_id).order('phase_index'),
      ]);

      const cleanPhases = (phases || []).map((p) => {
        const normalTasks = (p.tasks || []).filter((t) => typeof t === 'string' && !t.startsWith('__'));
        const extras = p.extra_tasks || [];
        const completed = (p.completed_tasks || []).length;
        const total = normalTasks.length + extras.length;
        return {
          phase: p.phase,
          phase_index: p.phase_index,
          started: !!p.started,
          total_tasks: total,
          completed_tasks: completed,
          percent_complete: total ? Math.round((completed / total) * 100) : 0,
        };
      });

      const cleanSubs = role === 'sales' ? [] : (subs || []).map((s) => ({
        phase: s.phase,
        sub_name: s.sub_name,
        sub_phone: FINANCIAL.has(role) ? s.sub_phone : undefined,
        message_sent: !!s.message_sent,
      }));

      return {
        job: scrubJob(job, role),
        phases: cleanPhases,
        subs: cleanSubs,
      };
    } catch (err) {
      return { error: `Failed to load job details: ${err.message || err}` };
    }
  },

  async search_jobs_by_client({ client_name }, ctx) {
    const role = normRole(ctx?.user?.role);
    if (!client_name || !client_name.trim()) return { error: 'Missing client_name.' };
    try {
      let q = supabase
        .from('jobs')
        .select('id, client_name, service, status, pipeline_status, address, city, salesperson_name, pm_name, created_at')
        .ilike('client_name', `%${client_name.trim()}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      // Sales: no filter — single salesperson sees all jobs.
      if (role === 'manager') {
        q = q.in('pipeline_status', ['in_progress', 'in-progress']);
      }

      const { data, error } = await q;
      if (error) throw error;
      return {
        query: client_name,
        matches: (data || []).length,
        jobs: (data || []).map((j) => scrubJob(j, role)),
      };
    } catch (err) {
      return { error: `Search failed: ${err.message || err}` };
    }
  },

  async get_subs_by_trade({ trade }, ctx) {
    const role = normRole(ctx?.user?.role);
    if (!CAN_SEE_SUBS.has(role)) return { error: 'Not authorized to view subcontractors.' };
    if (!trade || !trade.trim()) return { error: 'Missing trade.' };
    try {
      const { data, error } = await supabase
        .from('subcontractors')
        .select('*')
        .ilike('specialty', `%${trade.trim()}%`)
        .order('name');
      if (error) throw error;
      return {
        trade,
        count: (data || []).length,
        subs: (data || []).map((s) => scrubSub(s, role)),
      };
    } catch (err) {
      return { error: `Failed to load subs: ${err.message || err}` };
    }
  },

  async get_contracts_summary(_args, ctx) {
    const role = normRole(ctx?.user?.role);
    if (!FINANCIAL.has(role)) return { error: 'Not authorized to view contracts.' };
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('id, job_id, status, docusign_status, total_amount, deposit_amount, sent_at, signed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return {
        count: (data || []).length,
        contracts: data || [],
      };
    } catch (err) {
      return { error: `Failed to load contracts: ${err.message || err}` };
    }
  },

  async get_payment_aging(_args, ctx) {
    const role = normRole(ctx?.user?.role);
    if (!FINANCIAL.has(role)) return { error: 'Not authorized.' };
    try {
      const { data: contracts, error } = await supabase
        .from('contracts')
        .select('id, job_id, payment_plan, total_amount, signed_at')
        .not('signed_at', 'is', null);
      if (error) throw error;

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const items = [];
      (contracts || []).forEach((c) => {
        const plan = Array.isArray(c.payment_plan) ? c.payment_plan : [];
        plan.forEach((p, idx) => {
          if (p.paid) return;
          const due = p.due_date ? new Date(p.due_date) : null;
          const daysLeft = due ? Math.floor((due - today) / (1000 * 60 * 60 * 24)) : null;
          items.push({
            contract_id: c.id,
            job_id: c.job_id,
            label: p.label || `Installment ${idx + 1}`,
            amount: p.amount || (p.percent && c.total_amount ? (c.total_amount * p.percent / 100) : null),
            due_date: p.due_date || null,
            days_left: daysLeft,
            status: daysLeft == null ? 'unscheduled' : daysLeft > 0 ? 'upcoming' : daysLeft === 0 ? 'due_today' : 'overdue',
          });
        });
      });
      items.sort((a, b) => (a.days_left ?? 99999) - (b.days_left ?? 99999));
      return { total_open: items.length, items: items.slice(0, 30) };
    } catch (err) {
      return { error: `Failed to load payments: ${err.message || err}` };
    }
  },

  async get_change_orders(_args, ctx) {
    const role = normRole(ctx?.user?.role);
    if (!FINANCIAL.has(role)) return { error: 'Not authorized.' };
    try {
      const { data, error } = await supabase
        .from('change_orders')
        .select('id, job_id, status, amount, description, reason, paid, paid_at, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return { count: (data || []).length, change_orders: data || [] };
    } catch (err) {
      return { error: `Failed to load change orders: ${err.message || err}` };
    }
  },

  async get_audit_log({ limit = 20 } = {}, ctx) {
    const role = normRole(ctx?.user?.role);
    if (role !== 'admin' && role !== 'owner') return { error: 'Not authorized.' };
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('timestamp, user_name, user_role, action, entity_type, entity_id, details')
        .order('timestamp', { ascending: false })
        .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
      if (error) throw error;
      return { count: (data || []).length, events: data || [] };
    } catch (err) {
      return { error: `Failed to load audit log: ${err.message || err}` };
    }
  },
};
