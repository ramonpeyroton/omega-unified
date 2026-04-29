# Omega Unified — Context for Claude

> **Purpose:** Master context file for any Claude (or other AI) session
> working on this repo. Read it first. Update it when something
> structural changes — Ramon will say "atualiza o CLAUDE.md com X".

---

## Visão geral

**Omega Unified** é o aplicativo interno único da **Omega Development LLC**
— empresa de construção e reformas premium em Fairfield County,
Connecticut (decks, kitchens, bathrooms, additions, basements,
driveways, roofing, full renovations, new construction).

O app substitui planilhas e troca de mensagens entre os times. Cada
papel da empresa (dono, vendas, operações, gerente de obra, recepção,
admin) tem uma interface dedicada que compartilha o mesmo banco
Supabase. Resolve: pipeline comercial, estimativa, contrato (DocuSign),
fases de obra, custos, fotos, comunicação com subcontratados (Twilio
SMS/WhatsApp), e assistência por IA (Claude + Groq).

---

## Stack técnico

- **Vite 5.1** + **React 18.2** (porta dev `5174`).
- **Tailwind 3.4** com paleta customizada `omega-*` em `tailwind.config.js`.
- **Supabase JS 2.39** — Postgres + Realtime + Storage. Auth do Supabase
  está desativada; usamos PIN login client-side (sem cadastro).
- **Lucide React** para ícones.
- **`@dnd-kit/*`** para drag-and-drop (kanban do pipeline).
- **Sem React Router.** Roteamento é state-based dentro de cada
  `App.jsx` por papel. O `src/App.jsx` raiz inspeciona
  `window.location.pathname` para detectar a rota oculta `/admin-x9k2`
  e algumas rotas públicas. `react-router-dom` ainda aparece em
  `package.json` mas não é importado em lugar nenhum — pode ser
  removido numa limpeza futura.
- **Vercel Functions** em `api/` (Node) — endpoints serverless.
- **Vercel Cron** definido em `vercel.json` — `/api/daily-owner-update`
  roda diariamente às `0 13 * * *` (13h UTC).
- **APIs externas:**
  - **Anthropic (Claude)** — relatórios de projeto e projeção de custo.
  - **Groq (Llama 3.3)** — Jarvis chat com tool-calling.
  - **DocuSign** — contratos, estimates, e acordos com subcontratados.
  - **Twilio** — SMS + WhatsApp para subcontratados.
- **Hospedagem:** Vercel.

---

## Estrutura de pastas

```
omega-unified/
├── api/                      ← Vercel Functions (Node serverless)
│   ├── daily-owner-update.js   cron diário (resumo do dia pro dono)
│   ├── docusign-webhook.js     recebe eventos da DocuSign
│   ├── send-estimate.js        envia estimate por email
│   ├── send-visit-notification.js  notifica visita ao cliente
│   ├── sign-estimate.js        gera PDF assinado
│   ├── transcribe.js           voz → texto (Whisper/Groq)
│   └── twilio-send.js          SMS/WhatsApp para subs
├── migrations/               ← 20 SQL migrations numeradas (001–020)
│                               aplicadas manualmente no Supabase
├── scripts/                  ← shell scripts one-shot
│   ├── set-anthropic-key.sh
│   └── setup-github.sh
├── public/                   ← assets estáticos servidos como /…
│   ├── logo.png
│   └── pitch.html              pitch deck standalone
├── src/
│   ├── App.jsx                 router raiz (papel → app, rota oculta admin)
│   ├── Login.jsx               login público (PIN) — 7 papéis
│   ├── AdminLogin.jsx          login admin (PIN `0000`, rota /admin-x9k2)
│   ├── main.jsx                bootstrap React
│   ├── index.css               Tailwind base + customizações
│   ├── apps/                   1 sub-app por papel
│   │   ├── owner/                Inácio — dashboard completo
│   │   ├── operations/           Brenda — estimates, contratos, subs
│   │   ├── sales/                Attila — pipeline + novo job
│   │   ├── manager/              Gabriel — fases, calendário, warehouse
│   │   ├── receptionist/         Front desk (iPad/PC apenas, não mobile)
│   │   ├── admin/                Admin — usuários, pricing, audit
│   │   ├── screen/               TV/kiosk read-only (placeholder)
│   │   ├── marketing/            Ramon — read-only sem financeiro
│   │   ├── estimate-view/        público, sem login (cliente vê estimate)
│   │   └── sub-offer/            público (sub aceita/rejeita oferta)
│   ├── shared/                 código compartilhado entre apps
│   │   ├── components/           PipelineKanban, JobFullView,
│   │   │                         PhaseBreakdown, JarvisChat, etc.
│   │   ├── lib/                  supabase, audit, anthropic, groq,
│   │   │                         docusign, twilio, jarvisTools, etc.
│   │   └── config/               phaseBreakdown.js (templates por serviço)
│   ├── components/             componentes globais (LoadingSpinner)
│   ├── public/                 PrivacyPolicy + Terms (páginas públicas)
│   └── assets/                 logo.png compartilhado
├── package.json
├── vercel.json                 rewrites SPA + cron config
├── vite.config.js              porta 5174
├── tailwind.config.js          paleta omega-*
├── postcss.config.js
├── index.html
└── .env.example                template das env vars
```

---

## Fluxo do app

### Papéis e PINs

| PIN | Papel | Pessoa | Notas |
|-----|-------|--------|-------|
| `3333` | `owner` | Inácio | Dono. Acesso total de leitura. |
| `4444` | `operations` | Brenda | Estimates, contratos, DocuSign, pagamentos, subs. |
| `1111` | `sales` | Attila | Vendedor único — vê TODOS os jobs (não filtrado por nome). |
| `2222` | `manager` | Gabriel | Field PM. Fases, warehouse, calendário. **Sem dinheiro nem contratos.** |
| `9999` | `receptionist` | Front desk | Lead intake, agendamento. iPad/PC only. |
| `5555` | `screen` | Dash (placeholder) | Read-only para TV/kiosk. |
| `7777` | `marketing` | Ramon (placeholder) | Read-only, sem financeiro. |
| `0000` | `admin` | — | Rota oculta `/admin-x9k2`. **Nunca audit-logged.** |

PINs são checados na ordem: tabela `users` no Supabase primeiro
(admin-managed), fallback para a tabela hardcoded em `Login.jsx`.
Admin **nunca** está em `users` — o login admin é exclusivo da rota oculta.

### Navegação

- `src/App.jsx` decide qual sub-app renderizar com base em `user.role`.
- Cada sub-app (`src/apps/<role>/App.jsx`) faz seu próprio roteamento
  state-based — não há React Router.
- Rotas públicas (sem login): `/estimate-view/:id`, `/estimate-options/:id`,
  `/sub-offer/:id`, `/privacy`, `/terms`. Configuradas como rewrites em
  `vercel.json` para SPA.
- Rota admin oculta: `/admin-x9k2` (rewrite no Vercel, detectada por
  `pathname` no React).

### Pontos importantes

- **Questionário** vive no Sales app (`src/apps/sales/`), abre com
  service-picker e roda os checklists derivados do PDF "Estimate
  Checklist". Pula o picker se o job já tem um serviço setado.
- **Attila** vê todos os jobs (sem filtro por `salesperson_name`).
- **Subcontracted services** pulam o questionário inteiro.
- **Jarvis** (chat AI flutuante) é montado em todo sub-app via
  `src/shared/components/JarvisChat.jsx`. Tools são role-scoped via
  `src/shared/lib/jarvisTools.js`. Backend: Groq Llama 3.3.

---

## Caminhos importantes

- **Pasta local (Windows):** `C:\Users\ramon\Documents\omega-unified`
- **GitHub:** https://github.com/ramonpeyroton/omega-unified
- **Branch principal:** `main` — sempre trabalhar direto, **sem
  worktrees nem feature branches**.
- **URL produção:** https://omega-unified.vercel.app
- **Painel Vercel:** projeto `omega-unified` no dashboard
  `tioramos-8681`.
- **Supabase:** projeto ref `jbdtdyxzfejhotbjdnwm`
  (URL completa em `.env.example`).

---

## Deploy

**Automático** via integração Vercel ↔ GitHub. Todo `git push origin main`
dispara um deploy de produção em 1–2 min. Não usar `npx vercel --prod`
manual — está obsoleto.

A pasta `.vercel/` ainda está linkada localmente (gitignored) caso
precise rodar `vercel` CLI para debug, mas o caminho normal é
sempre **commit → push → Vercel constrói**.

---

## Workflow de desenvolvimento

1. **Antes de começar:** `git pull` para sincronizar com a outra máquina.
2. **Editar código direto na branch `main`** (sem criar worktrees).
3. **Testar local:** `npm run dev` (porta 5174).
4. **Commit:** `git add <arquivos>` (de preferência específico, não `git add .`)
   `git commit -m "tipo: descrição"`.
5. **Push:** `git push origin main`.
6. **Deploy automático** dispara na Vercel — verificar em 1–2 min.

Aplicar nova migration: copiar o SQL de `migrations/NNN_*.sql` no SQL
editor do Supabase e rodar manualmente. Não há migration runner
automatizado.

---

## Variáveis de ambiente

Definidas em `.env.example`. Setar como Production env vars no Vercel.

**Client (expostas ao browser — prefixo `VITE_`):**

| Var | Obrigatória | Para quê |
|-----|:-:|---|
| `VITE_ANTHROPIC_KEY` | ✅ | Claude API (relatórios + cost projection) |
| `VITE_GROQ_API_KEY` | ✅ | Groq (Jarvis chat) |
| `VITE_DOCUSIGN_INTEGRATION_KEY` | ⬜ | DocuSign client (opcional em dev) |
| `VITE_DOCUSIGN_ACCOUNT_ID` | ⬜ | DocuSign client |
| `VITE_DOCUSIGN_BASE_URL` | ⬜ | default `https://demo.docusign.net/restapi` |
| `VITE_DOCUSIGN_REDIRECT_URI` | ⬜ | default `http://localhost:5174/docusign/callback` |

**Server (Vercel Functions — sem prefixo `VITE_`):**

| Var | Obrigatória | Para quê |
|-----|:-:|---|
| `DOCUSIGN_INTEGRATION_KEY` | ✅ (se usa DocuSign) | servidor DocuSign |
| `DOCUSIGN_USER_ID` | ✅ (idem) | JWT auth user |
| `DOCUSIGN_ACCOUNT_ID` | ✅ (idem) | conta DocuSign |
| `DOCUSIGN_BASE_URL` | ✅ (idem) | default `https://demo.docusign.net/restapi` |
| `DOCUSIGN_OAUTH_BASE` | ✅ (idem) | default `https://account-d.docusign.net` |
| `DOCUSIGN_PRIVATE_KEY` | ✅ (idem) | RSA PEM (com `\n` literal) |
| `DOCUSIGN_HMAC_SECRET` | ⬜ | só se Connect HMAC ativo |
| `SUPABASE_URL` | ✅ | webhook + twilio-send |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | acesso server-side ao banco |
| `TWILIO_ACCOUNT_SID` | ✅ (se SMS/WA) | Twilio |
| `TWILIO_AUTH_TOKEN` | ✅ (se SMS/WA) | Twilio |
| `TWILIO_PHONE_NUMBER` | ✅ (se SMS) | E.164 (`+1203…`) |
| `TWILIO_WHATSAPP_FROM` | ✅ (se WA) | `whatsapp:+…` |

**Nunca commitar valores reais.** `.env`, `.env.local` e `.env.*.local`
estão no `.gitignore`.

---

## Identidade Git

Configurada globalmente:

- **Nome:** Ramon Peyroton
- **Email:** `276171615+ramonpeyroton@users.noreply.github.com`
  (noreply do GitHub — preserva privacidade do email pessoal)

Se outra máquina não tiver isso ainda:

```bash
git config --global user.name "Ramon Peyroton"
git config --global user.email "276171615+ramonpeyroton@users.noreply.github.com"
```

---

## Trabalho híbrido (duas máquinas)

Ramon trabalha em dois computadores (trabalho e casa). Em ambos a
pasta local é a mesma: `C:\Users\ramon\Documents\omega-unified`.

### Mnemônico (decora isso)

- 🌅 **Começou a trabalhar?** → **`pull`** (puxa do GitHub o que foi
  feito na outra máquina).
- 🌙 **Vai parar?** → **`go`** (Ramon fala "go" e o Claude faz
  `commit` + `push` — manda tudo pro GitHub).

```
push  =  EMPURRAR  (minha máquina  →  GitHub)
pull  =  PUXAR     (GitHub         →  minha máquina)
```

### Comandos que Ramon usa em chat

| Ramon diz | Claude faz |
|---|---|
| "começando" / "puxa o último" / "puxa de casa" | `git pull` |
| "go" / "manda" / "commita, push e deploy" | `git add` + `git commit` + `git push` (deploy é automático na Vercel) |
| "tá sincronizado?" | `git status` + diff vs `origin/main` |

### Por que isso importa

- Sem `pull` ao começar: trabalha em cima de versão velha → conflito
  na hora de pushar.
- Sem `go` ao terminar: a outra máquina amanhã não tem como pegar o
  que foi feito.
- `.claude/` está no `.gitignore` — cada máquina tem seu próprio
  estado/config local do Claude Code (permissões, MCPs, etc), por
  isso não sincroniza.

---

## Bugs conhecidos em aberto

- **Building Plans / Survey / Flooring sem questionário.** Quando o
  serviço escolhido é um dos três adicionados em `4773654 Add Flooring,
  Survey, and Building Plans services`, o card aparece sem CTA — só o
  botão "back to home". Falta wire-up do questionário (ou definir que
  esses serviços não usam um). Verificar
  `src/apps/sales/screens/QuestionnaireScreen.jsx` (ou equivalente).
- **Tabela `punch_list`** — referenciada em
  `jarvisTools.js#get_active_punch_list_items` mas a migration nunca
  foi criada. A tool trata o erro de tabela ausente, mas o feature não
  funciona até existir.
- **Tabelas legacy `job_phases` / `job_subs`** ainda existem no banco;
  o sistema novo usa `jobs.phase_data` (JSONB). Algumas telas do Owner
  ainda lêem das antigas — não apagar até migrar tudo.
- **`JobDetailDrawer` legado** ainda no código mas não é o caminho
  primário. Path novo é `JobFullView`. Mudanças de UX precisam tocar
  os dois ou apagar o drawer.
- **`react-router-dom` em `package.json`** sem nenhum import — pode
  ser removido numa limpeza.
- **Migration `021_job_cover_photo.sql` + bucket `job-covers`** — a
  feature de cover photo no Pipeline kanban depende de:
  1. Rodar `migrations/021_job_cover_photo.sql` no Supabase (adiciona
     `cover_photo_url TEXT` em `jobs`).
  2. Criar o bucket **público** `job-covers` em Supabase Storage.
  Frontend lida com `null` graciosamente (mostra placeholder) — então
  a app não quebra antes do setup, mas a feature só funciona depois.

---

## Decisões de arquitetura tomadas

Outra sessão **não deve refazer ou questionar** sem pedir antes:

- **Stack:** Vite + React (não Next.js, não SSR). Mantém leve e o
  dev loop é rápido.
- **Roteamento:** state-based dentro de cada sub-app, não React Router.
  Manter assim.
- **Auth:** PIN client-side, RLS permissiva no Supabase. Endurecer auth
  está adiado até Ramon avisar — não sugerir migração para Supabase Auth.
- **Deploy:** Vercel ↔ GitHub auto-deploy. Não voltar a `npx vercel --prod`
  manual.
- **Branch:** uma só (`main`). Sem worktrees, sem feature branches.
- **Repositório:** monorepo único — não dividir em
  owner/manager/sales separados.
- **`.claude/`** ignorado via `.gitignore`. Permissões e estado do
  Claude Code são per-machine.
- **Viewport prioritário por role** — não tratar tudo como mobile-first.
  Cada papel acessa de um dispositivo padrão e o layout deve priorizar ele:

  | Role | Dispositivo principal | Notas |
  |------|----------------------|-------|
  | Attila (sales) | 📱 **tablet** | tablet-first |
  | Gabriel (manager) | 📱 **tablet** | tablet-first |
  | Receptionist | 💻 **iPad/PC** | nunca tratar como celular |
  | Inácio (owner) | 🖥️ **desktop** | desktop-first |
  | Brenda (operations) | 🖥️ **desktop** | desktop-first |
  | Ramon (marketing) | 🖥️ **desktop** | desktop-first |
  | Screen | 🖥️ **desktop/TV** | read-only |
  | Admin | 🖥️ **desktop** | rota oculta |

- **Admin é hardcoded** — não está na tabela `users`. Não permitir que
  apareça em "Users & Access".
- **Logo única em `src/assets/logo.png`** — todos os `Logo.jsx` (Owner,
  Admin, Sales, Manager, Operations, Receptionist) e Login/AdminLogin
  importam desse caminho central. **Nunca** duplicar a logo dentro de
  `src/apps/<role>/assets/`. Para favicon/OG/emails, manter cópia
  espelhada em `public/logo.png`.
- **Sidebars são INDEPENDENTES por role** — não há um componente
  compartilhado. Cada `src/apps/<role>/components/Sidebar.jsx` é seu
  próprio arquivo. Se mudar o visual da sidebar, propagar manualmente
  pros 5 arquivos (Owner, Admin, Manager, Operations, Receptionist).
  Sales/Screen/Marketing usam padrões próprios — verificar antes.
- **Idioma:** UI em inglês, comentários e conversa com Ramon em PT-BR.

---

## O que NÃO fazer

- ❌ **NÃO criar worktrees novos.** Causa zumbis (Windows segura cwd
  e diretórios ficam "Device or resource busy"). Trabalhar direto na
  `main`.
- ❌ **NÃO criar branches `claude/*`** automáticas.
- ❌ **NÃO usar `npx vercel --prod`** manual — auto-deploy faz isso.
- ❌ **NÃO fazer refatorações grandes** sem pedir — projeto está em
  fase de teste/finalização com clientes reais.
- ❌ **NÃO commitar `.env.local`** ou qualquer coisa em `.claude/`.
- ❌ **NÃO mudar PINs** sem aprovação explícita (a regra de delete-job
  PIN está hardcoded em `JobFullView.jsx` e `JobDetailDrawer.jsx`).
- ❌ **NÃO sugerir migração para Supabase Auth** — adiada por decisão.
- ❌ **NÃO usar `git add .`** ou `git add -A` — pode pegar segredos
  ou arquivos locais. Adicionar arquivos por nome.
- ❌ **NÃO fazer `git commit --amend` nem `git push --force`** sem
  pedido explícito.

---

## Common pitfalls

1. **Empty strings vs NULL.** Postgres rejeita `''` em colunas `date`.
   Forms precisam converter `''` → `null` antes do insert/update. Padrão
   em `SubcontractorManager.jsx`:
   `Object.fromEntries(entries.map(([k,v]) => [k, v === '' ? null : v]))`.
2. **NOT NULL legado em `users`** — colunas históricas (ex. `email`,
   `password_hash`) que o fluxo PIN não preenche. Já foram dropadas via
   migration; em ambiente novo rodar `ALTER TABLE users ALTER COLUMN
   <col> DROP NOT NULL`.
3. **Role naming dual** — código suporta `sales` E `salesperson` (legado).
   Verificações usam `normRole()` em `jarvisTools.js`.
4. **Delete Job PIN** = Owner PIN (`3333`). Hardcoded em
   `JobFullView.jsx` e `JobDetailDrawer.jsx`. Se PINs mudarem,
   atualizar ambos.
5. **Viewport por role** (ver tabela em "Decisões de arquitetura").
   Resumo: Attila/Gabriel = tablet-first, Receptionist = iPad/PC,
   resto = desktop-first. Botões mínimo 40px no touch (tablet),
   inputs 16px de fonte em mobile/tablet (evita zoom do iOS).

---

## Como pedir atualizações deste arquivo

Sempre que algo importante mudar (nova decisão de arquitetura, novo
bug encontrado, mudança de fluxo), Ramon pode pedir:

> "atualiza o CLAUDE.md com X"

E o Claude Code edita a seção apropriada. Atualizar também:
- A linha de "Última atualização" no fim.
- A seção "Bugs conhecidos" quando algo for resolvido ou descoberto.

---

## Última atualização

**2026-04-29** — Ramon + Claude (Opus 4.7).
Logo centralizada em `src/assets/logo.png` (deletadas 5 cópias
duplicadas em `src/apps/<role>/assets/`). Adicionada tabela de
**viewports por role** (Attila/Gabriel = tablet, Receptionist = iPad/PC,
resto = desktop) — substitui a antiga regra "mobile-first geral".
Registrada decisão: **sidebars são independentes por role** (não há
componente compartilhado). Início do redesign visual da sidebar do
Owner (próxima rodada).

**2026-04-28** — Ramon + Claude (Opus 4.7).
Reescrita completa do CLAUDE.md baseada na análise do estado real do
repo: stack, 8 papéis em `src/apps/`, 20 migrations, Vercel cron,
auto-deploy via GitHub, identidade Git global, trabalho híbrido em duas
máquinas, decisões de arquitetura consolidadas.
