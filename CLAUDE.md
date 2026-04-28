# Omega Unified — Context for Claude

> **Purpose:** This is the master context file for any Claude (or other AI
> assistant) working on this repo. Read it first. It is the source of truth
> for company info, stack, roles, file structure, Supabase schema, and open
> bugs. Update it when you make structural changes.

---

## 🏢 Company

**Omega Development LLC** — premium construction & renovation in Fairfield
County, Connecticut. Services: decks, kitchens, bathrooms, additions,
basements, driveways, roofing, full renovations, new construction.

### People

| Role | PIN | Person | Notes |
|---|---|---|---|
| `owner` | `3333` | Inácio | Company owner. Full read access. |
| `operations` | `4444` | Brenda | Estimates, contracts, DocuSign, payments, subs. |
| `sales` | `1111` | Attila | Single salesperson — sees ALL jobs, not scoped. |
| `manager` | `2222` | Gabriel | Field PM. Phases, warehouse, calendar. **NO money / no contracts.** |
| `screen` | `5555` | Dash (placeholder) | Read-only pipeline for TV/kiosk displays. |
| `marketing` | `7777` | Ramon (placeholder) | Read-only pipeline, no financials. |
| `admin` | `0000` | — | **Hidden route `/admin-x9k2`.** Never audit-logged. |

### Developer

- **Ramon** — builds and maintains the app. Writes in Portuguese (PT-BR),
  ships the UI in English.

---

## 🛠 Stack

- React 18.2 + Vite 5.1 (dev port **5174**)
- Tailwind CSS 3.4 (custom `omega-*` palette in `tailwind.config.js`)
- Supabase JS 2.39 (PostgreSQL + Realtime + Storage + Auth-disabled, we use PIN login)
- Lucide React for icons
- `@dnd-kit/*` for drag-and-drop (pipeline kanban)
- No React Router — **state-based routing inside each role App.jsx**; root
  `App.jsx` switches apps by `user.role` and detects `/admin-x9k2` via
  `window.location.pathname`.
- Deploy: **automatic** via Vercel ↔ GitHub. Pushes to `main` on
  `github.com/ramonpeyroton/omega-owner` trigger a production deploy.
  Manual fallback: `npx vercel --prod` from the repo root (`.vercel/`
  folder is still linked locally).
- AI: Claude (Anthropic) for reports/cost projection, Groq Llama 3.3 for
  Jarvis chat.

---

## 🎨 Design system

- Background: `#FAFAF8` (`bg-omega-cloud`) for body, `#2C2C2A`
  (`bg-omega-charcoal`) for dark surfaces (sidebars, headers).
- Accent: `#E8732A` (`text-omega-orange`, `bg-omega-orange`). Hover
  `#C45E1A` (`bg-omega-dark`).
- Neutral scale: `omega-slate`/`omega-stone`/`omega-fog` from dark to light.
- Mobile-first. Min button height 40px on small screens, inputs use 16px
  font to avoid iOS zoom.
- Rounded corners: `rounded-xl` default, `rounded-2xl` for modals/cards
  that want more presence.

---

## 📁 File structure (important bits)

```
omega-unified/
├── api/
│   └── docusign-webhook.js    — Vercel Function for DocuSign events
├── public/
│   ├── logo.png
│   └── pitch.html             — standalone pitch deck (standalone HTML)
├── src/
│   ├── App.jsx                — root router (role → app, hidden /admin-x9k2)
│   ├── Login.jsx              — public login (6 roles via PIN)
│   ├── AdminLogin.jsx         — hidden admin login (/admin-x9k2)
│   ├── assets/logo.png
│   ├── components/
│   │   └── LoadingSpinner.jsx
│   ├── shared/
│   │   ├── components/
│   │   │   ├── PipelineKanban.jsx   — 8-column drag-drop kanban (supports readOnly prop)
│   │   │   ├── JobFullView.jsx      — full-screen job detail with tabs (Report, Phases, Financials, …)
│   │   │   ├── JobDetailDrawer.jsx  — legacy slide-in drawer (still used in some places)
│   │   │   ├── PhaseBreakdown.jsx   — sub-item checklist per phase (used by Owner and JobFullView)
│   │   │   ├── ProjectReportSection.jsx — AI report viewer (read-only, from `jobs.latest_report`)
│   │   │   ├── CostProjectionSection.jsx — AI cost projection (cached in `jobs.cost_projection`)
│   │   │   ├── JobCostingSection.jsx — manual revenue/cost/margin form
│   │   │   ├── JobExpensesSection.jsx — actual expenses log
│   │   │   ├── DailyLogsSection.jsx
│   │   │   ├── TimeTrackingSection.jsx
│   │   │   ├── PaymentAging.jsx
│   │   │   ├── PhasePhotos.jsx
│   │   │   ├── MarkdownReport.jsx   — renders `###SECTION###` AI reports
│   │   │   ├── NotificationsBell.jsx
│   │   │   ├── JarvisChat.jsx       — floating chat panel (Groq + role-scoped tools)
│   │   │   ├── Toast.jsx, StatusBadge.jsx, LoadingSpinner.jsx, COIBadge.jsx
│   │   ├── config/
│   │   │   └── phaseBreakdown.js    — per-service phase templates
│   │   └── lib/
│   │       ├── supabase.js
│   │       ├── audit.js             — `logAudit` — **skips admin role**
│   │       ├── notifications.js
│   │       ├── docusign.js          — client wrapper (calls /api/docusign/*)
│   │       ├── anthropic.js         — Claude calls (shared)
│   │       ├── groq.js              — Groq chat + tool-calling loop
│   │       ├── jarvisTools.js       — role-scoped tools for Jarvis
│   │       └── backButtonGuard.js   — prevents browser back from exiting app
│   └── apps/
│       ├── owner/     — full Owner UI (dashboard, job detail, subs, reports)
│       ├── operations/— Brenda's dashboard, contracts, subcontractors, pipeline
│       ├── sales/     — Attila's home, new job, questionnaire, pipeline
│       ├── manager/   — Gabriel: phase board, punch list, warehouse, calendar
│       ├── admin/     — Admin-only (users, pricing, company settings, audit, templates)
│       ├── screen/    — placeholder (read-only pipeline)
│       └── marketing/ — placeholder (read-only pipeline)
```

Each role app has `App.jsx`, `screens/`, `components/`, `lib/`, `assets/`.

---

## 🗄 Supabase schema (core tables)

Project ref: `jbdtdyxzfejhotbjdnwm`. Public anon key in `src/shared/lib/supabase.js`.

### jobs (main entity)
```
id UUID PK
client_name, client_phone, client_email, address, city, service
status (legacy)  — 'draft', 'to_quote', 'in-progress', 'completed', etc.
pipeline_status  — 'new_lead' | 'estimate_sent' | 'estimate_approved' |
                   'contract_sent' | 'contract_signed' | 'in_progress' |
                   'completed' | 'on_hold'
salesperson_name, pm_name, pm_id
answers JSONB            — questionnaire answers
phase_data JSONB         — { phases: [{id,name,completed,items:[{id,label,done}]}] }
report, report_raw, latest_report   — AI-generated project report (Claude)
report_generated_at TIMESTAMP
questionnaire_modified BOOLEAN, questionnaire_modified_at TIMESTAMP
cost_projection JSONB    — AI cost projection (Anthropic)
cost_projection_at TIMESTAMP
pricing_reference JSONB  — legacy
created_at, updated_at, start_date
```

### estimates
```
id, job_id, created_by, status, total_amount, payment_plan JSONB,
line_items JSONB, notes, sent_at, approved_at, approved_by,
change_request TEXT, change_requested_at, status_detail
```

### contracts
```
id, job_id, estimate_id, status, docusign_envelope_id, docusign_status,
payment_plan JSONB, total_amount, deposit_amount,
sent_at, signed_at, signed_by, pdf_url, deposit_invoice_sent_at
```

### change_orders
```
id, job_id, contract_id, status, description, amount, reason,
paid BOOLEAN, paid_at
```

### subcontractor_agreements
```
id, job_id, subcontractor_id, status, scope_of_work, their_estimate,
payment_plan JSONB, start_date, end_date, docusign_envelope_id,
docusign_status, signed_at
```

### subcontractors
```
id, name, trade, phone, email, tax_id,
insurance_company, insurance_policy_number,
coi_url, coi_expiry_date, coi_alert_sent, specialty, active_jobs_count
```

### job_phases (legacy — being replaced by jobs.phase_data)
```
id, job_id, phase, phase_index, tasks, extra_tasks, completed_tasks, started
```

### job_subs (legacy)
```
id, job_id, phase, phase_index, sub_name, sub_phone, message_sent
```

### job_reports (versioned history)
```
id, job_id, report_content TEXT, generated_at, generated_by UUID,
questionnaire_snapshot JSONB, version INTEGER
```

### job_costs, job_expenses, phase_photos, daily_logs, time_entries
(see each component for column list — everything created via `IF NOT
EXISTS`)

### Admin tables
- `users` — PIN/role/active (admin is NOT here on purpose)
- `pricing_reference` — service/item/unit/price_per_unit
- `company_settings` — name, address, phone, email, license, insurance, logo_url
- `audit_log` — user_name, user_role, action, entity_type, entity_id, details
- `message_templates` — name, category, message
- `notifications` — recipient_role, title, message, type, job_id, read, seen

### RLS
All tables have permissive RLS (`allow_all_<table>`) to both `anon` and
`authenticated`. This is intentional for v1 (client-side enforcement
only — PIN login = no real auth). Tighten when migrating to Supabase Auth.

---

## 🔑 Environment variables

**Client (exposed to browser — prefix `VITE_`):**
- `VITE_ANTHROPIC_KEY` — Claude API key (reports + cost projection)
- `VITE_GROQ_API_KEY` — Groq key (Jarvis chat)
- `VITE_DOCUSIGN_INTEGRATION_KEY`, `VITE_DOCUSIGN_ACCOUNT_ID`,
  `VITE_DOCUSIGN_BASE_URL`, `VITE_DOCUSIGN_REDIRECT_URI`

**Server (Vercel Functions only — no `VITE_` prefix):**
- `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`
- `DOCUSIGN_BASE_URL`, `DOCUSIGN_OAUTH_BASE`
- `DOCUSIGN_PRIVATE_KEY` (RSA PEM)
- `DOCUSIGN_HMAC_SECRET` (optional)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (webhook + twilio-send logging)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` (E.164 SMS sender, e.g. `+12035551234`)
- `TWILIO_WHATSAPP_FROM` (e.g. `whatsapp:+14155238886` — Twilio sandbox or approved sender)

Set on Vercel → Settings → Environment Variables for Production.

---

## ✉️ SMS / WhatsApp (Twilio)

- Server: `api/twilio-send.js` — POSTs to Twilio REST.
- Client helper: `src/shared/lib/twilio.js` (`sendMessage`, deep-link fallbacks, templates).
- UI:
  - Per-phase button in `PhaseBreakdown.jsx` — opens a sub picker (SMS / WhatsApp),
    pre-fills the confirmation template, sends via `/api/twilio-send`.
  - Job-wide tab "Contact" in `JobFullView.jsx` (roles: manager, owner, operations, admin).
  - Manager `PhaseView.jsx` has a "Contact Subs" header toggle that swaps the phase list for the contact list.
- Audit: every send (success/fail) is written to `message_log` via the service role key
  — run `migrations/002_message_log.sql` once to create the table.
- Fallback: if Twilio isn't configured, the modal still lets the user open the native
  `sms:` URI or `wa.me` link.

## 🔒 Session / "Remember me"

- Helper: `src/shared/lib/authStorage.js` (`saveSession`, `loadSession`, `clearSession`).
- Checkbox on both `Login.jsx` and `AdminLogin.jsx` — default **off**.
  - Off → sessionStorage (same behavior as before, cleared with the tab).
  - On  → localStorage with 30-day expiry; auto-cleared on next load when expired.
- Legacy keys `omega_unified_user` / `omega_unified_admin` are still read on first load
  and migrated to the new v2 keys so existing logged-in sessions don't get bounced.

---

## 🤖 Jarvis (AI assistant)

- Component: `src/shared/components/JarvisChat.jsx` (floating panel)
- Visible on every role's screen (mounted inside each role App)
- Backend: Groq Llama 3.3 via `src/shared/lib/groq.js`
- Tools: `src/shared/lib/jarvisTools.js` (role-scoped)
- Language auto-detect (EN/PT)
- System prompt adapts per role (addresses Inácio for owner, Brenda for ops, etc.)

Tool access matrix is baked into `getToolsForRole()` in `jarvisTools.js`.
Financial tools (contracts, payments, change orders, audit) require
`admin | owner | operations`.

---

## 🐛 Known open items

- **Legacy `JobDetailDrawer`** still exists but is no longer the primary
  path. `JobFullView` is used from PipelineKanban + dashboards. If you
  make UX changes, apply to both or delete the drawer.
- **`job_phases` / `job_subs`** tables still exist but the new phase
  system uses `jobs.phase_data` (JSONB). Leave legacy tables alone for
  now — some Owner screens still read them.
- **Punch list** (`punch_list` table) — not created in DB yet. The
  Jarvis tool `get_active_punch_list_items` handles the missing-table
  case gracefully.
- **QA reports** (`relatorio-qa-*.md`) are auto-generated by Anthropic
  skills and git-ignored.

---

## 🚧 Common pitfalls

1. **Empty strings vs NULL** — Postgres rejects `''` for `date` columns.
   Forms must convert `''` → `null` before insert/update. See
   `SubcontractorManager.jsx` for the pattern: `Object.fromEntries(entries
   .map(([k,v]) => [k, v === '' ? null : v]))`.
2. **Legacy NOT NULL columns** — the `users` table has historical
   NOT-NULL columns (e.g. `email`, `password_hash`) that the PIN flow
   doesn't fill. Those were dropped via migration, but if you create a
   new env re-run `ALTER TABLE users ALTER COLUMN <col> DROP NOT NULL`.
3. **Role naming** — support BOTH `sales` and `salesperson` for legacy
   data. Matrix checks use `normRole()` in `jarvisTools.js`.
4. **Delete Job PIN** — hardcoded to Owner PIN (`3333`). If PINs change,
   update `JobFullView.jsx` and `JobDetailDrawer.jsx`.
5. **Admin is hardcoded** — not in `users` table. Do NOT let admin be
   deletable via `Admin > Users & Access`. The UI hides it already.

---

## 🧭 Rules for future Claude sessions

1. **Never break what works.** Read before editing.
2. **Never change PIN login** without explicit approval.
3. **Mobile-first always.** Check min width 390px.
4. **Handle loading / empty / error** in every data component.
5. **Never expose server secrets** to the client (`VITE_` prefix = client).
6. **App UI is English.** Comments/docs/conversation with Ramon are Portuguese.
7. **When schema changes, update this file.** Especially the Supabase
   schema section.
8. **When you add a role**, update the Roles section above.
9. **When something's genuinely unknown**, ask Ramon — don't guess.

---

_Last updated: 2026-04-28 — Ramon + Claude (Opus 4.7)_
