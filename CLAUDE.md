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
- **React Router DOM 6** — **atualizado 2026-06 (sessão Junho/26)**.
  Era state-based; agora 6 dos 7 sub-apps usam `BrowserRouter` + `Routes`
  pra preservar tela em refresh e suportar deep links pra clientes
  (`/jobs/:id?tab=daily`). Detalhes: ver seção "URL Routing migration"
  em "Última atualização". O `src/App.jsx` raiz ainda inspeciona
  `window.location.pathname` pra rotas públicas + rota oculta
  `/admin-x9k2`. **Admin** é o único app que ainda é state-based.
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
├── migrations/               ← 67+ SQL migrations numeradas
│                               aplicadas manualmente no Supabase.
│                               IMPORTANTE: 065, 066, 067 pendentes
│                               de rodar (ver "Última atualização").
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
- **`ProjectAnalyzer.jsx` e `Warehouse.jsx` (owner) AINDA quebradas**
  com `VITE_ANTHROPIC_KEY` direto no browser — vão dar 401 quando
  Inácio usar. Migrar pro `/api/ai-proxy` igual aos outros 4 arquivos.
- **Admin app NÃO migrado** pra URL routing — ainda é state-based.
  Funciona, mas refresh em `/admin-x9k2` volta pra tela inicial do admin.
- **Profile só edita pra users cadastrados na tabela `users`.** Logins
  via fallback hardcoded (`PIN_TO_ROLE` em `Login.jsx`) abrem o modal
  de profile em modo read-only com aviso "Ask the admin to register
  you". Fase 3 (auth hardening, próxima rodada) remove o fallback.

- **Lição armazenada — "renderSlackMrkdwn" e ordem de operações.**
  Bug que custou ~7 commits hoje 29/04 antes do fix definitivo
  (`78d709a`). Sintoma: mensagens postadas via app apareciam como HTML
  literal `<a href="..." class="text-omega-orange...">URL</a>` cru no
  Daily Logs. **Causa real:** a própria pipeline em
  `src/shared/components/ProjectChat.jsx` gerava `<a>` tags reais nos
  passes 3-4 (Slack `<URL>` → `<a>`) e em seguida o passe 5
  (`/</g, '&lt;'`) escapava ESSES MESMOS `<a>` que ela acabou de gerar.
  `dangerouslySetInnerHTML` decodava `&lt;a` de volta pra `<a` mas como
  texto, não como tag. **Solução final** (commit `78d709a`):
  placeholder tokens — cada `<a>` gerado é estacionado em ` L<id>`
  (U+0000 NUL ao redor) ANTES do escape pass; restaurados no final.
  **Lição pra futuras pipelines de markdown→HTML:** se a função
  GERA HTML em alguns passes e ESCAPA HTML em outros, sempre estacione
  o gerado em tokens neutros antes do escape. Nunca confiar em "passe
  na ordem certa" — ordem é frágil, tokens são robustos.

---

## Decisões de arquitetura tomadas

Outra sessão **não deve refazer ou questionar** sem pedir antes:

- **Stack:** Vite + React (não Next.js, não SSR). Mantém leve e o
  dev loop é rápido.
- **Roteamento:** **React Router DOM 6** com BrowserRouter em cada
  sub-app (6 de 7 migrados em Junho/26 — Admin pendente). Padrão:
  `<BrowserRouter>` no App raiz da role, `<Routes>` com `<Outlet>`
  num shell persistente (Sidebar + JarvisChat ficam montados). Job
  vira rota `/jobs/:id?tab=X`. Back inside card sempre vai pra
  `/pipeline` (regra do Ramon). Não voltar a state-based.
- **Chat interno = Native Chat** (chat_messages + chat_reads +
  Realtime). Slack foi removido em Junho/26. Não reativar Slack.
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

## Mapa rápido — onde encontrar coisas (Junho/26)

Pra próximo Claude que precisar entender o estado depois da sessão massiva
de Junho/26 sem ler a seção inteira de "Última atualização":

**Chat interno (Daily Logs):**
- Componente puro: `src/shared/components/NativeProjectChat.jsx`
  (prop `embedded` desliga chrome quando dentro de wrapper)
- Wrapper Slack-style 2 colunas: `src/shared/components/DailyLogsRichTab.jsx`
  (filtros All/Mentions/Unread/Starred/Files + lista lateral)
- Cascade no sidebar: `src/shared/components/DailyLogsList.jsx`
- Sino realtime: `src/shared/components/NotificationsBell.jsx`
- Tabelas: `chat_messages`, `chat_reads`, `jobs.chat_members[]`,
  `jobs.last_chat_message_at` (migration 066)

**URL Routing:**
- Cada `src/apps/<role>/App.jsx` agora é um `BrowserRouter` + `Routes`
  com `<Outlet>` num shell persistente. Padrão idêntico nos 6 apps
  migrados (Sales, Owner, Operations, Manager, Receptionist, Marketing).
- Job rotes: `/jobs/:id?tab=X`. State `from` rastreia origem; Back
  fallback sempre vai pra `/pipeline`.
- vercel.json tem catch-all SPA rewrite no final.
- Pra migrar Admin (pendente): usar `basename="/admin-x9k2"` no
  `BrowserRouter`.

**Acorn Finance:**
- Card: `src/apps/estimate-view/EstimateView.jsx` (entre customer
  message e signature flow)
- URL: `https://www.acornfinance.com/pre-qualify/?d=O6LD4&utm_medium=user_pre_qual_link&loanAmount=X`
- Toggle por job: `estimate.show_financing` (default true, migration
  065 PENDENTE)
- Banner PNG no `~/Downloads/lg-acorn-finance-banner.png` do Ramon

**AI:**
- Proxy unificado: `api/ai-proxy.js`. Aceita `{provider: 'claude'|'groq'}`.
- Pra Claude: aceita `prompt` (string) OU `messages` (array completo
  pra image/document blocks), `model` (override default haiku), `tools`,
  `anthropicBeta` (header).
- Shared libs: `src/shared/lib/anthropic.js`, `src/shared/lib/groq.js`.
- Per-role libs: `src/apps/sales/lib/anthropic.js`,
  `src/apps/owner/lib/anthropic.js`, `src/apps/manager/lib/anthropic.js`,
  `src/apps/sales/screens/PDFUpload.jsx` — todos migrados pro proxy.
- **AINDA QUEBRADOS** (não migrados): `ProjectAnalyzer.jsx` e
  `Warehouse.jsx` no owner. Migrar quando der.

**Notifications:**
- send-estimate.js handleEstimateOpened insere notificações pra
  `sales`, `operations`, `owner` (3 rows) na primeira abertura.
- `recipientRolesFor()` em `src/shared/lib/notifications.js` mapeia
  user.role → roles que recebe.
- Bell click navega pra `/jobs/:id?tab=<tipo-específico>` via
  `tabForNotification()` exportado de NotificationsBell.

---

## Como pedir atualizações deste arquivo

Sempre que algo importante mudar (nova decisão de arquitetura, novo
bug encontrado, mudança de fluxo), Ramon pode pedir:

> "atualiza o CLAUDE.md com X"

E o Claude Code edita a seção apropriada. Atualizar também:
- A linha de "Última atualização" no fim.
- A seção "Bugs conhecidos" quando algo for resolvido ou descoberto.

---

## Features em desenvolvimento (roadmap)

### Chat por projeto via Slack — em planejamento

**Conceito:** cada card de projeto vai ter uma seção "Daily Logs" que
mostra mensagens de um canal específico do Slack workspace da Omega
Development. O Slack é a fonte da verdade dos dados; o app só renderiza
visualmente dentro do contexto do projeto.

**Decisões já tomadas:**

- **Slack workspace:** já existe, plano Pro (histórico ilimitado, sem
  perda de dados).
- **Backend:** APIs em `api/slack/*.js` (Vercel serverless functions).
- **Database:** tabela `jobs` ganha coluna `slack_channel_id`
  (Supabase).
- **Autenticação inicial:** Bot Token único (Opção A) — todas as
  mensagens postadas pelo app aparecem como "Omega Bot" no Slack.
  Migrar pra OAuth por usuário (Opção B) só se necessário pós-launch.
- **Atualização de mensagens:** polling de 30 segundos (não tempo real
  ainda, suficiente pra começar).
- **Upload de arquivos:** proxy via backend
  (`api/slack/upload-file.js`) — navegador nunca toca no token do Slack.
- **Equipe:** apenas usuários internos da Omega (vendedor, gerente,
  dono). Cliente externo não tem acesso.

**Cronograma planejado** (4 sprints, 8-10 dias úteis):

- **Sprint 1 — Fundação:** criar Slack App, configurar permissões,
  gerar tokens, teste de conexão básica. *(work fora do código —
  feito no dashboard do Slack pelo Ramon)*
- **Sprint 2 — Backend:** ✅ **concluído.** APIs em `api/slack/`,
  helpers compartilhados em `api/_lib/`, migration 023 adiciona
  `jobs.slack_channel_id`, dependência `@slack/web-api` instalada.
- **Sprint 3 — Frontend leitura:** ✅ **concluído.** Componente
  `src/shared/components/ProjectChat.jsx` substitui a render anterior
  na aba **Daily Logs** de `JobFullView`. Polling de 30s, empty state
  com input pra colar `slack_channel_id`, parser leve de Slack mrkdwn,
  parse da credit-line e fallback pra `users.list` (lookup de
  `user_id → real_name`) pra mensagens postadas direto no Slack.
  `DailyLogsSection` legacy permanece no codebase — não foi deletado.
- **Sprint 4 — Frontend escrita + uploads:** ✅ **concluído.** Caixa
  de mensagem com Enter-to-send + Shift+Enter pra nova linha.
  Botão paperclip pra anexar imagem (jpeg, png, webp, heic, heif).
  `browser-image-compression` em Web Worker antes de upload (target
  2 MB / quality 0.8 / max 2400px), hard-cap 4 MB pós-compressão pra
  ficar abaixo do limite ~4.5 MB do body do Vercel. Anexos enviados
  via multipart/form-data pra `api/slack/send-message` (mesmo endpoint;
  parsing via `formidable` quando Content-Type é multipart). Imagens
  postadas direto no Slack aparecem no app como thumbnail inline (max
  320×240) graças ao novo endpoint `api/slack/file-proxy.js` que
  baixa o arquivo com o token e devolve sem auth pro browser.
  Avatares no chat usam `colorFromName` pra dar uma cor estável por
  pessoa (paleta de 8 hues).

**Status atual:** Feature **Chat por projeto via Slack** entregue
end-to-end (Sprints 1-4). Em produção precisa: `migration 023` rodada,
bucket `job-covers` com policies (ver migration 021), env vars
`SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` na Vercel, e scopes do
Slack App: `channels:history`, `channels:read`, `chat:write`,
`files:read`, `files:write`, `users:read`. Próximas iterações
(opcionais, fora do roadmap original): mensagens em tempo real via
Slack Events API, OAuth por usuário, lookup automático de canais ao
criar job, threads e reactions.

**Regra do projeto:** cada Sprint termina com `commit + push` antes de
iniciar o próximo. Sem trabalho não-commitado entre sprints.

**O que NÃO fazer (decisões de arquitetura travadas):**

- ❌ NÃO armazenar mensagens próprias do app — Slack é fonte da verdade.
- ❌ NÃO usar WebSocket / Slack Events API ainda (fica pra v2 se
  necessário).
- ❌ NÃO implementar OAuth por usuário antes do Bot Token funcionar.
- ❌ NÃO subir arquivos direto do navegador pro Slack — sempre via
  proxy backend.

---

## Última atualização

**2026-06-06 (Mobile QA audit completo + redesign Marketing + features Manager)** — Ramon + Claude (Opus 4.6/4.7).

Sessão focada em polir o mobile. 10 commits, 40+ arquivos tocados. Resumo por tema:

### 📱 Marketing mobile redesign
- **Bottom bar mobile** criada (Pipeline/Leads/Logs/More) com ativo em laranja
  e `safe-bottom`.
- **MobileMoreSheet** com Perfil + Sign Out.
- Sidebar `hidden md:flex`, rota `/daily-logs` → `MobileDailyLogs`.
- `<main>` com `pb-[calc(4rem+env(safe-area-inset-bottom))]`.
- Arquivo novo: `src/apps/marketing/components/MobileMoreSheet.jsx`.

### 🔔 Push notification format
- Body da notificação agora inclui `#NomeDoCliente Chat:` + mensagem.
- Antes era só a preview crua. Agora dá contexto de qual projeto.

### 🏗️ Manager dashboard cleanup
- **Removidos**: 3 KPIs, 4 quick actions, seção "Issues That Need Attention".
- **Avatar** do Gabriel adicionado no header (canto direito).
- **Reordenado**: Today's Jobs primeiro → To Do List → Materials Run.

### ✅ Phase Breakdown (shared, mobile+desktop)
- **Auto-expand** na última fase com progresso parcial (não mais a 1ª).
- **done_by / done_at**: cada item marcado como feito grava quem e quando.
  Exibido em 9px abaixo do item (`Nome · Jun 6 8:40 AM`). Items antigos
  ficam sem (sem dado retroativo).

### 📋 Quick Receipts (Manager)
- **3 chips de ordenação**: Status (default), Name (A→Z), City (A→Z).
- **Persistência via localStorage** — Gabriel reabre e já tá na última
  ordenação que escolheu.

### 🔍 QA Audit mobile completo — 96 issues encontrados, 88 resolvidos

Auditoria completa da versão mobile de todos os roles. Resultados:

| Severidade | Total | Resolvidos |
|-----------|:-----:|:----------:|
| Críticos | 9 | 9 ✅ |
| Altos | 14 | 14 ✅ |
| Médios | 38 | 36 ✅ |
| Baixos | 35 | 29 ✅ |

**Fixes mais impactantes (Críticos resolvidos):**
1. Safe-area padding do Sales: `pb-16` → `pb-[calc(...+env(safe-area))]`
2. Sales `<main>` duplo com padding 128px: inner `<main>` → `<div>`
3. Manager bottom bar z-30 → z-40 (consistente com outros apps)
4. JobFullView z-40 → z-[45] (acima do bottom bar, abaixo de modais)
5. Delete de notificação `opacity-0` → `opacity-60` (visível em touch)
6. Star button `hidden md:inline-flex` → `inline-flex` (visível no mobile)
7. `useJobById` `.catch()` em 6 cópias (sem mais loading infinito)
8. Chat overlay: `pt-[max(0.5rem,env(safe-area-inset-top))]` (notch)
9. Owner Dashboard drawer: `w-[400px]` → `w-full max-w-[400px]`

**Deduplicação:**
- `useJobById` extraído de 6 App.jsx → `src/shared/hooks/useJobById.js`
  (-175 linhas de código duplicado)
- `@keyframes slideUp/slideInRight` movidos de inline `<style>` → `index.css`
- Imports cross-app removidos (manager/marketing não importam mais de
  `../owner/lib/supabase`)

**Accessibility (a11y) melhorada:**
- Bottom bars: `min-h-[44px]` + `aria-label="Main navigation"`
- PageHeader: `aria-label` no back, `aria-hidden` no ícone
- MobileMoreSheet: Escape key dismiss (4 arquivos)
- UserProfileModal: Escape key, close button maior, photo button maior
- NotificationsBell: animation, `role="button"`, empty state com ícone
- DailyLogsRichTab: `role="button" tabIndex={0}` nos chat items
- QuickTasksList: `focus-visible:ring` nos inputs, padding nos checkboxes
- PipelineKanban: delete button visível no mobile, tooltip nos headers
- Report dialog: `role="dialog" aria-modal="true"`

**Skipped (by design / complexo demais pra LOW):**
- Marketing sem notificações (read-only)
- MobileMoreSheet swipe-to-dismiss (requer gesture library)
- Owner bottom bar 7 itens (não dá pra remover features)

### 🛠️ PENDÊNCIAS — código (próximo Claude)

| Tarefa | Arquivo(s) | Esforço |
|--------|-----------|---------|
| Migrar **Admin app** pra URL routing | `src/apps/admin/App.jsx` | 1-2h (precisa `basename="/admin-x9k2"`) |
| Migrar **ProjectAnalyzer.jsx** pro AI proxy | `src/apps/owner/screens/ProjectAnalyzer.jsx` | 30 min |
| Migrar **Warehouse.jsx** pro AI proxy | `src/apps/owner/screens/Warehouse.jsx` | 30 min |
| Deletar `useBackNavHome` / `useBackButtonGuard` quando Admin migrar | `src/shared/lib/backNav.js`, `backButtonGuard.js` | 5 min |
| **Replicar redesign mobile** no **Operations** e **Receptionist** | `src/apps/operations/`, `src/apps/receptionist/` | 2-3h |
| Bug: Flooring/Survey/Building Plans sem questionário | `src/apps/sales/screens/QuestionnaireScreen.jsx` | 1-2h |

---

**2026-06-04/05 (Push notifications + redesign mobile dos 3 apps de campo + Jarvis out)** — Ramon + Claude (Opus 4.8).

Sessão LONGA (2 dias), muitos commits. Resumo por tema:

### 🔔 Push notifications (Web Push / PWA) — feature COMPLETA, em produção
Time é **só iPhone**. Entregue 100% no plano grátis (Vercel Hobby).
- **PWA instalável:** `public/manifest.webmanifest`, `public/sw.js` (service
  worker: trata `push` + `notificationclick` com deep-link), metas no
  `index.html`, registro do SW em `src/main.jsx`. **Favicon** adicionado
  (`<link rel="icon" href="/logo.png">`).
- **Infra:** `migrations/069_push_subscriptions.sql` (tabela
  `user_push_subscriptions` + `calendar_events.reminder_sent_at`),
  dependência `web-push`, helper client `src/shared/lib/push.js`. UI de ativar
  + guia de instalação iOS no `UserProfileModal.jsx`.
- **Worker de envio:** TUDO dentro de `api/daily-owner-update.js` (sem função
  nova — limite de 12) roteando por `?task=`:
  - `POST ?task=send` (protegido por `OMEGA_API_SECRET`) → menção no Daily Log.
  - `GET ?task=reminders` (cron externo 15min) → lembrete 2h antes do evento.
  - `GET` sem task (cron Vercel diário) → resumo do dia por usuário.
- **Cron externo grátis:** `.github/workflows/push-cron.yml` (a cada 15min,
  curl no `?task=reminders`).
- **Gatilho de menção:** `NativeProjectChat.jsx` chama `apiFetch
  ('/api/daily-owner-update?task=send', {userNames: mentions, ...})` após
  inserir a mensagem.
- **Caveat iOS (Apple):** cada pessoa precisa **Adicionar à Tela de Início**
  (instalar PWA) E **dar permissão dentro do app instalado**. Sem isso, sem push.
- **ENV (Ramon setou + redeploy):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VITE_VAPID_PUBLIC_KEY` (client), `OMEGA_API_SECRET` (server) =
  `VITE_OMEGA_API_SECRET` (client, **mesmo valor**) + GitHub repo secret.
  **`VITE_*` são build-time → exigem redeploy.**
- **🪤 Pegadinha cara (resolvida):** menção salvava certo mas **não chegava
  push**. Causa: o `apiFetch` do browser manda `x-omega-secret` =
  `VITE_OMEGA_API_SECRET`; se esse ≠ `OMEGA_API_SECRET` (server), o endpoint
  dá **401 silencioso** (`.catch(()=>{})` engole). **Lição:** todo endpoint
  protegido (twilio, ai-proxy, send-estimate, daily-owner-update…) depende do
  `VITE_OMEGA_API_SECRET` bater com `OMEGA_API_SECRET`, E de um redeploy após
  setar. Diagnóstico: curl com secret = 200; sem/errado = 401.

### 🗑️ Jarvis removido
Chat IA flutuante apagado de todos os apps. Deletados `JarvisChat.jsx` e
`jarvisTools.js`. `groq.js` fica (client genérico, usado pelo Screen). **Não
reintroduzir.**

### 📱 Redesign mobile dos 3 apps de campo (Attila/Inácio/Gabriel)
Padrão consolidado — **só mobile**, desktop intacto:
- **`PageHeader` é o padrão de head** de toda tela secundária (barra fina
  branca: `← Home/Back · chip do ícone · título · subtítulo`). Aplicado em
  Sales, Owner e Manager (telas próprias + rotas das compartilhadas
  Calendar/Finance). Telas "home" (Sales Home, Owner/Manager dashboards)
  mantêm header próprio (com logo).
- **Regra de UI travada:** **NUNCA botões dentro do head** — sempre puxar pra
  uma barra de ações ABAIXO do `PageHeader` (senão sobrepõe o título no mobile).
- **Barra de baixo (mobile):** itens uniformes, **ativo em laranja**, sem FAB.
  Excedente vai num **menu "More" (•••)** → bottom sheet (`MobileMoreSheet.jsx`,
  um por app: sales/owner/manager) com Perfil + Sign Out. **Respeitar
  `safe-bottom`** (safe-area iPhone) na barra + `pb-[calc(4rem+env(safe-area-
  inset-bottom))]` no `<main>`.
- **`JobFullView` (card do cliente) mobile:** header CLARO (branco), abas
  viraram **dropdown da seção atual** (em vez de barra que rola), Estimate Flow
  movido pro dropdown, badges com mesmo tamanho (`min-w-[7rem] h-8`), header
  reorganizado (nome+endereço, ícones call/email/questionário, status+serviço
  lado a lado, "← Pipeline").
- **Daily Logs mobile:** seção dedicada via bottom-bar (`MobileDailyLogs.jsx` +
  `DailyLogsRichTab` responsivo: lista↔chat com overlay `fixed inset-0 z-50`).
- **Sales:** dashboard mobile redesenhado (mockup do Ramon) — KPI cards, funil
  CSS.
- **`PipelineKanban` mobile:** header interno removido (usa `PageHeader` da
  rota); **esconde TODO valor $ pra `HIDE_MONEY_ROLES` = {manager, marketing,
  screen}** (Gabriel não vê dinheiro — regra do Ramon).

### 🧰 App do Manager (Gabriel)
- **Today → dashboard:** `MobileRedirect` foi pra raiz do router (roda 1× no
  load) → abrir o app cai em `/receipts`, mas clicar em **Today** mostra o
  dashboard (Job of the Day) em vez de bouncar.
- **Barra de baixo:** Today · Jobs · Receipts · Logs · Alerts · More.
- **Cards (Active Jobs):** chip do serviço ao lado do nome, endereço sem CEP +
  sem cidade redundante (CEP fica no link do Maps), **miniatura da foto de
  capa** (`job.cover_photo_url`) no lugar do anel, **barra fina** de progresso.
  Progresso vem do **`job.phase_data`** (`progressFromPhaseData`), NÃO da tabela
  legacy `job_phases` (que dava 0% falso).
- **`serviceBadgeLabel(value)`** novo em `src/shared/data/services.js` — espaça
  nomes concatenados (newconstruction → "New Construction").

### 💬 Daily Logs / Chat — 2 fixes
- **Manager vê todos os jobs ativos no Daily Logs:** `chat_members` é
  preenchido por trigger pra todos **exceto manager/admin/screen**. O
  `DailyLogsRichTab` agora **pula o filtro `chat_members`** pra esses roles
  (`ROLES_WITHOUT_CHAT_ACL`), senão a lista do Gabriel ficava vazia.
- **@menção com picker:** `NativeProjectChat` ganhou autocomplete — digita `@`
  e abre dropdown filtrando a base = **usuários ativos ∪ chat_members** (managers
  também são marcáveis). Picker insere `@Nome Completo`.

### ⚠️ Pendências
- **Rodar migration 069** no Supabase se ainda não (push já funciona em prod →
  provavelmente já rodada).
- **Replicar headers/More-sheet** no **Operations (Brenda)** e **Receptionist**
  (só Sales/Owner/Manager feitos).
- Migrations antigas 065/066/067 — ver entrada de Junho/02 abaixo.

---

**2026-06-02 (Sessão massiva: Slack out, Daily Logs nativo, URL routing, Acorn, mais)** — Ramon + Claude (Opus 4.7 / Sonnet 4.6).

Foi uma sessão LONGA com muitas frentes. Lista organizada por tema:

### 🗑️ Slack removido (commits após 2eaa53b)
- **Plano canceled de Slack** — Ramon decidiu apagar tudo e usar chat nativo.
- **Migration 047** já estava rodada — todos jobs com `use_native_chat=true`.
- **Migration 066** criada: drop `jobs.slack_last_message_at`, adiciona
  `jobs.last_chat_message_at` + trigger que atualiza em cada insert em
  `chat_messages`. **PENDENTE rodar no Supabase**.
- **Removidos do código:** `src/shared/components/ProjectChat.jsx`,
  `api/slack/[action].js`, `api/_lib/slack.js`.
- **JobFullView** simplificado — não tem mais `if (use_native_chat) ... else ProjectChat`, agora SEMPRE usa o native.
- **Env vars Slack no Vercel** (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`)
  podem ser removidas — não usadas mais. Ramon pode cancelar plano Slack.

### 💬 Native Chat — feature completa "Daily Logs" estilo Slack

Estado: **funcionando em produção**.

**Camada de dados (migrations já rodadas: 043, 046, 047. Pendentes: 066, 067):**
- `chat_messages` (job_id, author_name, author_role, body, attachments
  jsonb, mentions text[], created_at, edited_at, deleted_at) — Realtime
  habilitado.
- `chat_reads` (job_id, user_name, last_read_at) + **migration 067 adiciona
  `is_starred boolean`** (pra "Starred chats" filter).
- `jobs.chat_members` (text[]) — ACL. Trigger BEFORE INSERT preenche
  automaticamente com todos users ativos exceto manager/admin/screen.
- `jobs.last_chat_message_at` (timestamptz) — adicionada pela migration
  066, mantida pelo trigger.

**Componentes principais:**
- `src/shared/components/NativeProjectChat.jsx` — o chat puro (mensagens
  + composer). Aceita prop `embedded={true}` que desliga rounded/border/
  altura fixa quando renderizado dentro de outro wrapper.
- `src/shared/components/DailyLogsRichTab.jsx` — Slack-style 2 colunas
  (lista de chats à esquerda + chat à direita). Substitui o
  `<NativeProjectChat>` direto dentro da aba Daily Logs do JobFullView.
  Filtros: All / Mentions / Unread / Starred / Files. Click em outro
  chat na lista chama `onSwitchJob(newJob)` que o JobFullView usa pra
  trocar o job todo (com nova URL via React Router).
- `src/shared/components/DailyLogsList.jsx` — cascade que aparece no
  sidebar de cada role app. Lista compacta dos chats.
- `src/shared/components/NotificationsBell.jsx` — sino com Realtime,
  popover, click navega pra `/jobs/:id` na aba certa por tipo.

**Visual:**
- Sidebar lateral: bg-omega-pale (creme com tom laranja, era preto)
- Filtros: omega-orange quando ativo
- Mensagens: agrupadas por autor (Slack-style) — primeiro msg da run
  mostra avatar + nome + horário; consecutivas ficam compactas embaixo
- Avatar usa `users.profile_photo_url` quando disponível
- Date separators entre dias
- Composer: pinned no bottom (flex-shrink-0)
- Aba Daily Logs ocupa 100% da viewport disponível (no JobFullView,
  ela é exceção do `max-w-5xl` que vale pra outras tabs)

**Upload de arquivos no chat:**
- **Múltiplos** arquivos por mensagem (até 10, configurável em
  `MAX_ATTACHMENTS_PER_MESSAGE`)
- Aceita imagens (`image/*`) + PDFs (`application/pdf`)
- Imagens passam por `browser-image-compression` (target 2 MB, max
  2400px, hard cap 4 MB pós-compressão)
- PDFs passam direto sem processamento
- Preview em grid (thumbnail pra imagens, ícone pra PDFs)
- Cada arquivo enviado é espelhado em `job_documents` (folder
  `daily_logs`) — automático

**Notificações de estimate aberto:**
- `send-estimate.js` handleEstimateOpened insere 3 rows em
  `notifications` (sales, operations, owner) quando o cliente abre
  o estimate pela primeira vez
- Email também é enviado pra `company.email` na primeira abertura
- Sales tem o NotificationsBell shared (com Realtime) — substitui o
  sino "burro" que ele tinha antes
- Click numa notificação abre o JobFullView na aba certa por tipo:
  - `estimate`, `contract`, `change_order` → aba estimate
  - `finance`, `payment` → aba financials
  - `pipeline` → aba daily
  - default → aba daily

**Tela de Notifications (sales):**
- Filtro Unread/All (default Unread)
- Botões Mark all read + Clear all read
- Delete individual em cada card

### 🌐 URL Routing migration

**Antes:** state-based por papel — refresh sempre voltava pra dashboard,
back do navegador idem.

**Agora (6 de 7 apps migrados):**
- **Sales** ✅, **Owner** ✅, **Operations** ✅, **Manager** ✅,
  **Receptionist** ✅, **Marketing** ✅
- **Admin** ⏳ pendente (precisa de `basename="/admin-x9k2"` no
  BrowserRouter pra coexistir com a rota oculta).

**URL patterns:**
- `/` → dashboard / landing da role
- `/<screen>` → cada tela secundária (pipeline, finance, etc)
- `/jobs/:id?tab=daily` → JobFullView (tab via query)
- `/jobs/:id/<sub-screen>` → flows que entram a partir do job
  (questionnaire, estimate-flow, report, etc)

**Regras consistentes (válidas em todos os apps migrados):**
1. **Refresh preserva tela** — URL é fonte da verdade
2. **Back do navegador** funciona naturalmente
3. **Link compartilhável** pra cada job (`/jobs/abc-123?tab=daily`)
4. **Back dentro do card sempre volta pra `/pipeline`** (regra explícita
   do Ramon, fallback quando `location.state.from` não está set)
5. **Sidebar + JarvisChat persistentes** entre navegações via
   nested routes com `<Outlet>` (não re-montam a cada nav)
6. **State de fluxo intermediário** (phases pra AssignSubs, prefill
   pra NewJob, scheduleJob pra Receptionist) preservado via
   `sessionStorage` em vez de parent useState

**Padrão de Back handler em JobFullView routes:**
```js
const handleClose = () => {
  const from = location.state?.from;
  navigate(from || '/pipeline');
};
```

**Mudança crítica em `PipelineKanban`:**
- Antes: tinha `openJob` useState interno + renderizava JobFullView inline
- Agora: aceita prop opcional `onOpenJob` — quando fornecida, clicks
  delegam a ela em vez de abrir overlay interno. Sem a prop, comportamento
  legado preserved (pra apps ainda não migrados).

**vercel.json atualizado** com SPA rewrites pra:
- Cada tela: `/pipeline`, `/calendar`, `/finance`, etc
- `/jobs/:path*`
- Catch-all final: `/((?!api/|assets/|.*\..*).*) → /` pra qualquer
  rota nova SPA cair em `index.html`

**`useBackNavHome` / `useBackButtonGuard`** ainda existem em
`src/shared/lib/` mas não são mais usados pelos apps migrados. Mantidos
pra Admin (que ainda é state-based). Quando Admin for migrado, podem
ser deletados.

### 🏦 Acorn Finance — opção de financiamento no estimate

**Conta de partner já criada** pelo Inácio. Partner code: **`O6LD4`**.

**URL pública pré-qualify:**
```
https://www.acornfinance.com/pre-qualify/?d=O6LD4&utm_medium=user_pre_qual_link&loanAmount=<total>
```

**Detalhes:**
- Até **$100k** de loan, prazos até 20 anos, 30+ lenders no marketplace.
- **0% impacto no crédito** pra checar oferta — mensagem oficial.
- Sem branding obrigatório (verified com Bethany do Acorn no chat).
- **Tracking é por nome do cliente, NÃO por estimate** — limitação do
  Acorn (eles confirmaram). Pra granular precisa redirect próprio.

**Implementação:**
- Card no `src/apps/estimate-view/EstimateView.jsx` (entre customer
  message e signature flow)
- **Toggle por estimate** via `estimate.show_financing` (default `true`)
- **Migration 065 PENDENTE** rodar — adiciona a coluna
- Brenda/Attila desligam manualmente no EstimateBuilder por job
- Banner PNG do Acorn (`lg-acorn-finance-banner.png`) salvo no Downloads
  do Ramon — pode ser usado em PDFs impressos futuramente

**Visual final** (paleta peach/laranja claro):
- Card cinza claro, com bg peach interno
- Header: "Need Flexible Payments? — Financing through our partner"
- 2 mini-cards: "Starting at $X/mo (estimated over 84 months)" e
  "Check your rate — Free, won't impact your credit"
- Bullets com 3 benefícios
- Botão "See my financing options →"
- "Powered by Acorn Finance" no rodapé

### 🔧 AI Proxy — fix de 6 arquivos que estavam quebrados

Após o security hardening de Maio/26, `VITE_ANTHROPIC_KEY` foi removido
do client. Mas 6 arquivos ainda usavam ele direto:
1. `src/apps/sales/lib/anthropic.js` — report generation
2. `src/apps/sales/screens/PDFUpload.jsx` — PDF analysis
3. `src/apps/owner/lib/anthropic.js` — report/pricing/phases + property search
4. `src/apps/manager/lib/anthropic.js` — material image scan
5. `src/apps/owner/screens/ProjectAnalyzer.jsx` — PDF→images analysis **(ainda quebrado, não migrado)**
6. `src/apps/owner/screens/Warehouse.jsx` — material AI scan **(ainda quebrado, não migrado)**

**Os 4 primeiros foram migrados** pra usar `apiFetch('/api/ai-proxy')`.
O proxy foi **estendido** pra aceitar:
- `messages` (array completo — pra image/document content blocks)
- `model` (override — sonnet em owner, haiku em sales)
- `tools` (pra web_search beta)
- `anthropicBeta` (header opcional)

**Pendência:** ProjectAnalyzer.jsx e Warehouse.jsx ainda usam
`VITE_ANTHROPIC_KEY` direto — quando Inácio for usar essas features,
vão dar 401. Migrar pro proxy é trivial usando o mesmo padrão.

### 📋 Questionário — várias edições

**Deck — reorganizado completamente:**
- Ordem nova: `deck_type` (1ª pergunta) → extension desc → dimensões
  → material → superfície (board type/specs/hidden screws/picture frame)
  → resto do Overview
- **PVC removido** do `deck_material` (PT/Cedar/Composite apenas)
- **Fascia simplificada** pra Azek/No fascia (2 opções, era 3)
- Section "Decking Surface" eliminada (perguntas movidas pro Overview)
- Lattice mantida em "Trim & Extras"

**Bathroom:**
- `bath_shower_material` ganhou opção **TBD**
- `bath_glass` renomeado de "Glass enclosure" → "Glass Door"
- **Nova pergunta `bath_tile_orientation`**: Horizontal / Vertical /
  Herringbone / Chevron / Diagonal / Running bond (offset) / Grid
  (stacked). Autofill atualizado em `estimateAutofill.js`.

**Permit (todos os serviços padronizados):**
- 3 opções unificadas: **Already have / Need to get / Not required**
- Removido "Don't know" de todos
- Aplicado em bathroom, kitchen, deck, roofing + fallback schema

**Owner pode preencher questionário:**
- Botão "Questionnaire" no header do JobFullView aparece pro owner
  (antes era só pro sales)
- Inácio pode preencher se o vendedor não preencheu

### 🔍 Audit Log

- Antes: limite hardcoded de 100 eventos, sem filtro de tempo
- Agora: **seletor de range** (Last 7 days / 4 weeks / 3 months / 12
  months / All time), default **4 weeks**
- Limite máximo: 5000 rows quando "All time"

### 📊 Estimate UI

**Bug fix histórico (`9e716b7`):** Edit button na aba Documents
abria o EstimateBuilder no estimate ERRADO. Causa: variável renomeada
pela metade — `latest` foi pra `rootEstimate` mas uma referência ficou.
Try/catch engolia o erro silenciosamente. Fix: trocou a referência
remanescente.

**Preview Estimate abre nova aba** — trocado de popup window (com
dimensões) pra `<a target="_blank">` simples. Mais confiável em iOS.

### 📱 Outros fixes notáveis

- **Estimate questionnaire crash** quando Attila tentava gerar relatório
  via IA — era o `VITE_ANTHROPIC_KEY` removido (resolvido via AI proxy)
- **Notification bell do Sales** trocado de link estático pra
  `NotificationsBell` shared com Realtime
- **Daily Logs** agora aparece no cascade da sidebar em TODOS os roles
  (sales, owner, operations, manager, receptionist, marketing, admin)
- **DailyLogsRichTab** mostra a coluna esquerda inteira em viewport
  larga, com lista de chats expandindo até `w-96` (era `w-64`)

### 🐛 Bugs corrigidos no final da sessão (importante pra próximo Claude)

- **JobFullView race condition** (commit `f0a1016`):
  - Sintoma: clicar em **"Open Estimate Flow"** ou **"Questionnaire"**
    dentro do card do cliente, em vez de abrir o flow, voltava pra
    `/pipeline`.
  - Causa: o JobFullView chamava `onOpenEstimateFlow(job)` E em
    seguida `onClose?.()`. Com URL routing, AMBOS viraram `navigate()`
    e a segunda chamada sobrescrevia a primeira.
  - Fix: remover o `onClose?.()` redundante das 7 ocorrências
    (`onClick={() => { onOpen...(job); }}` agora — sem o close). A
    navegação `navigate('/jobs/:id/estimate-flow')` já tira da rota
    `/jobs/:id`, então o close manual é redundante.
  - **Lição pra futuras integrações JobFullView**: nunca encadear
    `onClose?.()` depois de um callback que navega; deixe o router
    desmontar o componente.

- **Sales Sidebar persistente** (commit `424a6ee`):
  - SalesSidebar foi extraído de `Home.jsx` pra
    `src/apps/sales/components/SalesSidebar.jsx`.
  - O `SalesShell` no App.jsx envolve TODAS as rotas com a sidebar
    + `<Outlet/>` — sidebar agora aparece em Home, Pipeline,
    Estimates, Notifications, Leads, Commissions, Calendar, etc.
  - Home.jsx ficou só com o conteúdo (KPIs + cards), sem sidebar
    interno.
  - Padrão idêntico ao Owner/Operations/Manager (mesma estratégia
    de Shell + Outlet).

- **Back button regra "sempre /pipeline"** (commit `50b8a36`):
  - O botão Back do JobFullView agora SEMPRE volta pra `/pipeline`
    como fallback, mesmo em hard refresh / link compartilhado.
  - `location.state.from` continua tendo prioridade (volta pra
    Estimates/Notifications/Leads se foi de lá), mas o fallback
    final é `/pipeline` em vez de `/`.
  - Replicar essa regra ao migrar Manager / Receptionist /
    Marketing pra URL routing.

### ⚠️ PENDÊNCIAS — Ramon precisa fazer

| Item | Onde | Prioridade |
|------|------|------------|
| **Rodar migration 065** (`estimate.show_financing`) | Supabase SQL editor | 🟡 (Acorn financing toggle não persiste sem ela) |
| **Rodar migration 066** (`jobs.last_chat_message_at`) | Supabase SQL editor | 🟡 (unread badges no pipeline) |
| **Rodar migration 067** (`chat_reads.is_starred`) | Supabase SQL editor | 🟡 (Starred filter no Daily Logs) |
| **Adicionar `ANTHROPIC_KEY`** no Vercel | Env vars | 🔴 (IA features) |
| **Adicionar `GROQ_API_KEY`** no Vercel | Env vars | 🔴 (Jarvis) |
| **Adicionar `OMEGA_API_SECRET`** + `VITE_OMEGA_API_SECRET` (igual valor) | Env vars | 🔴 (proxy auth) |
| **Remover `VITE_ANTHROPIC_KEY`** + `VITE_GROQ_API_KEY` | Env vars | 🟢 (limpeza) |
| **Cancelar plano Slack** | slack.com | 🟢 (não usa mais) |
| **Remover env vars Slack** (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`) | Vercel | 🟢 (limpeza) |
| **Investigar logins Brenda Dasilva pós-demissão** (5/12 + 5/19) | Supabase logs + Vercel logs | 🔴 (segurança) |
| **Mudar PIN da Brenda** se não foi mudado | Admin → Users | 🔴 (acesso pós-demissão) |

### 🛠️ PENDÊNCIAS — código (próximo Claude)

| Tarefa | Arquivo(s) | Esforço |
|--------|-----------|---------|
| Migrar **Admin app** pra URL routing | `src/apps/admin/App.jsx` | 1-2h (precisa `basename="/admin-x9k2"`) |
| Migrar **ProjectAnalyzer.jsx** pro AI proxy | `src/apps/owner/screens/ProjectAnalyzer.jsx` | 30 min |
| Migrar **Warehouse.jsx** pro AI proxy | `src/apps/owner/screens/Warehouse.jsx` | 30 min |
| Deletar `useBackNavHome` / `useBackButtonGuard` quando Admin migrar | `src/shared/lib/backNav.js`, `backButtonGuard.js` | 5 min |
| **PIN-gated** features no Daily Logs (delete msg / edit) | NativeProjectChat.jsx | 1h |
| **Mention autocomplete** já existe mas pode polir | NativeProjectChat.jsx | opt |

### 🎨 Design system unification — Sales (em andamento)

Ramon flagou em Junho/26 que o Sales tinha "cara de esqueleto" — cada
tela com header / cards / tipografia diferente. Decisão: **manter
paleta atual + padronizar componentes** (não muda direção visual).

**Já feito** (commit `eafa80f`):
- Criado `src/shared/components/ui/PageHeader.jsx` — header único pra
  todas as telas secundárias. Sticky branco com back + ícone + título
  + subtítulo + actions slot.
- Aplicado em: Pipeline, Calendar, Estimates, Notifications, Leads,
  Commissions (no Sales). Notifications também ganhou sub-header
  branco com filtros (era header preto charcoal antes).

**Próximas etapas pra ele:** (pode pedir "continua o refactor visual do Sales")
1. **Padronizar `<Card>`** — várias telas usam `rounded-xl border border-gray-200`
   manual; trocar pelo shared `<Card>` (`rounded-2xl shadow-card border-black/[0.04]`).
2. **Tipografia consistente** — definir tokens (`text-display`, `text-title`,
   `text-body`, `text-caption`) pra parar a mistura de `font-bold`/`font-black`/`font-semibold`.
3. **Spacing scale** — usar só `p-4` / `p-6` / `p-8` (não `pt-12 pb-5` ad-hoc).
4. **Aplicar PageHeader nos outros 5 apps** (Owner, Operations, Manager,
   Receptionist, Marketing) — padrão é claro, copia-cola adaptando título/ícone.
5. **NewJob.jsx, PreviousJobs.jsx, PDFUpload.jsx, Questionnaire.jsx,
   Report.jsx, ReviewAnswers.jsx** ainda têm header próprio.

---

**2026-05-16 (Security hardening + My Leads refactor)** — Ramon + Claude (Sonnet 4.6).

### Security hardening — 4 problemas identificados, 3 resolvidos (commit `c14eb60`)

**Problema 1 ✅ — API keys fora do browser bundle:**
- `VITE_ANTHROPIC_KEY` e `VITE_GROQ_API_KEY` foram removidos do client-side.
- Novo `api/ai-proxy.js` — proxy único (1 function) que roteia por `{ provider: 'claude' | 'groq' }`. Lê `ANTHROPIC_KEY` e `GROQ_API_KEY` server-side. Mantém o limite de 12 functions do Vercel Hobby.
- `src/shared/lib/anthropic.js` reescrito para chamar `/api/ai-proxy`.
- `src/shared/lib/groq.js` reescrito para chamar `/api/ai-proxy`.

**Problema 2 ✅ — HMAC DocuSign obrigatório:**
- `api/docusign-webhook.js`: verificação HMAC era pulada quando `DOCUSIGN_HMAC_SECRET` não estava configurado. Agora rejeita (`return false`) se a secret não estiver configurada. Comparação atualizada para `crypto.timingSafeEqual()` (timing-safe).

**Problema 4 ✅ — Shared secret token em todos os endpoints internos:**
- Novo `api/_lib/requireSecret.js` — middleware que valida header `x-omega-secret` contra env var `OMEGA_API_SECRET`. Em dev sem a var: avisa no log e deixa passar. Em prod: 401.
- `requireSecret` adicionado em: `twilio-send.js`, `send-estimate.js` (depois do beacon público), `send-visit-notification.js`, `transcribe.js`, `send-invoice.js`, `slack/get-messages.js`, `slack/send-message.js`, `docusign/[action].js`.
- Novo `src/shared/lib/apiFetch.js` — wrapper de `fetch` que injeta `x-omega-secret` automaticamente. Lê `VITE_OMEGA_API_SECRET`.
- `apiFetch` usado em: `anthropic.js`, `groq.js`, `twilio.js`, `docusign.js`, `ProjectChat.jsx`, `EstimateBuilder.jsx`, `EstimateFlow.jsx`, `Calendar/EventForm.jsx`, `VoiceNoteRecorder.jsx`.
- **Endpoints propositalmente públicos (SEM proteção):** `api/sign-estimate.js` (clientes assinam estimates), beacon `action:'opened'` em `send-estimate.js`, `EstimateView.jsx` (página pública do cliente).

**Problema 3 ⏳ — RLS real no Supabase (adiado):**
- Depende de Supabase Auth. Adiado até Ramon ativar o Auth.

**Env vars que Ramon precisa adicionar no Vercel (Settings → Environment Variables):**

| Ação | Variável | Valor |
|------|----------|-------|
| ➕ Adicionar | `OMEGA_API_SECRET` | string longa aleatória (ex: `openssl rand -hex 32`) |
| ➕ Adicionar | `VITE_OMEGA_API_SECRET` | **mesmo valor** que `OMEGA_API_SECRET` |
| ➕ Adicionar | `ANTHROPIC_KEY` | mesma chave que estava em `VITE_ANTHROPIC_KEY` |
| ➕ Adicionar | `GROQ_API_KEY` | mesma chave que estava em `VITE_GROQ_API_KEY` |
| 🗑️ Remover | `VITE_ANTHROPIC_KEY` | não mais usado |
| 🗑️ Remover | `VITE_GROQ_API_KEY` | não mais usado |
| ➕ Futuro | `DOCUSIGN_HMAC_SECRET` | quando DocuSign for ativado em produção |

**Migrations pendentes:** `062_user_preferences.sql` (My Leads — ainda não rodada no Supabase).

---

### My Leads refactor — concluído (sessão anterior)

`src/apps/receptionist/screens/LeadsList.jsx` reescrito com:
- Toggle Cards / List view.
- Sort dropdown (modo cards, 11 opções).
- Filter panel com chips removíveis (Status, Source, Owner, Pipeline).
- Cards com borda esquerda colorida por status.
- Preferências salvas em `user_preferences` (migration 062 — rodar no Supabase).
- Default por role: `sales`/`owner` → cards; `receptionist`/`operations`/`marketing` → list.

---

**2026-05-05 (Finance reconstruction + Job amount received)** — Ramon + Claude (Sonnet 4.6).

**Finance Screen reconstruído do zero** (`src/shared/components/Finance/FinanceScreen.jsx`):
- **QuickBooks removido completamente** — app é agora 100% self-contained. Brenda imprime relatório e lança no QB manualmente.
- **Company tab**: 5 KPIs internos (Receivable 30d, Received MTD, Owed to Subs 30d, Ghost Checks MTD, Net Cash MTD) + job health breakdown (profitable/at-risk/loss count) + botão "Print Report".
- **Print Report**: função `openPrintReport()` busca todos os dados financeiros e abre HTML formatado em nova janela com `window.print()` — sem servidor, sem dependência externa.
- **Clients tab**: `PaymentDrawer` ganhou CRUD completo — `+ Add Installment`, lápis (edit) e lixeira (delete, só status `pending`) em cada milestone. Modal `MilestoneFormModal` reutilizável (label, due_amount, due_date).
- **Subs tab**: `SubPaymentDrawer` idêntico ao Clients — add/edit/delete sub payments. Reutiliza `MilestoneFormModal`.
- **Bank Accounts**: botão Delete com confirmação + audit log.
- **Ghost Account tab**: mantido sem alterações (importa `GhostAccountTab`).
- Todos os CRUD com `logAudit()` para rastreabilidade.

**JobCostingSection** (`src/shared/components/JobCostingSection.jsx`):
- Novo campo "Amount Received from Client" (destacado em verde, separado por borda).
- 6 KPI cards no resumo: Revenue / Total Cost / Gross Profit / Margin % / **Received** / **Balance Due**.
- `amount_received` salvo em `job_costs.amount_received` (migration 050).

**Pendências do Ramon:**
- Rodar SQL no Supabase para criar tabela `job_costs` (ver SQL fornecido na conversa — inclui `amount_received`). **Sem isso a aba Financials dos jobs mostrará erro.**
- Migration 026 (`finance.sql`) também precisa estar rodada para Finance screen funcionar.

**O que NÃO está implementado (decisões travadas):**
- ❌ QuickBooks sync — removido. App é fonte da verdade, QB é destino manual via print.
- ❌ Lembretes automáticos — ver `project_finance_reminders_pending.md`.

---

**2026-04-30 (madrugada — QuickBooks read-only)** — Ramon + Claude (Opus 4.7).
Sprint 2 do Finance entregue: integração QuickBooks read-only. **⚠️ OBSOLETO** — QB foi removido na sessão de 2026-05-05. Ver entrada acima.

**Backend** (`api/quickbooks/*` + `api/_lib/quickbooks.js`):
- Migration 027 — tabela `quickbooks_tokens` (1 row por realm/company,
  guarda access+refresh tokens, expiração, ambiente sandbox/production).
- `auth.js` — inicia OAuth (302 → Intuit Authorize URL com state CSRF).
- `callback.js` — recebe code+realmId, troca por tokens, persiste,
  302 de volta com `?qb=connected` ou `?qb=error&reason=`.
- `status.js` — diz se há conexão ativa.
- `disconnect.js` — revoga em Intuit + apaga linha.
- `balances.js` — query QBO API por contas Bank/Credit Card ativas,
  retorna saldos.
- Helpers: `getValidAccessToken()` faz refresh automático se o
  access_token expira em <60s, persistindo o novo refresh_token (que
  rotaciona a cada call — perder = perder conexão).

**Frontend** ([FinanceScreen.jsx](src/shared/components/Finance/FinanceScreen.jsx)
Company tab):
- Card "Saldos das contas (QuickBooks)" com botão "Conectar QuickBooks"
  (verde QB) quando desconectado.
- Quando conectado: lista das contas com saldo, botões "Atualizar" e
  "Desconectar", timestamp da última atualização.
- Toast de sucesso/erro lendo `?qb=connected|error&reason=` da URL após
  bounce-back do OAuth.

**Env vars necessárias no Vercel** (Ramon setou):
- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_REDIRECT_URI`
- `QUICKBOOKS_API_BASE` (sandbox: `https://sandbox-quickbooks.api.intuit.com`)
- `QUICKBOOKS_ENV` (sandbox / production)

**Pendências do Ramon:**
- Rodar **migration 027** no Supabase.
- (Já feito) Setar env vars no Vercel.
- Testar fluxo OAuth completo: ir em Finance → Company → "Conectar
  QuickBooks" → escolher sandbox company → autorizar → ver saldos.
- Quando estiver pronto pra produção: completar tasks "App details" no
  Intuit Developer Portal pra desbloquear Production credentials, daí
  trocar `QUICKBOOKS_*` env vars pra Production e ajustar
  `QUICKBOOKS_API_BASE` pra `https://quickbooks.api.intuit.com`.

**O que NÃO está implementado** (decisões travadas):
- Sync write (Sprint 4 / opção C) — app não escreve no QB. Sempre
  read-only. Marcar pagamento no app NÃO cria invoice no QB.
- Lembretes automáticos (Sprint 2A) — adiados, ver memory file
  `project_finance_reminders_pending.md`.

**2026-04-30 (noite — Finance v1)** — Ramon + Claude (Opus 4.7).
Sprint 1 da área Financeiro entregue. Item "Finance" novo na sidebar
de **owner / operations / admin** (Brenda + Inácio + admin). Página
com 3 abas: **Company** (agregados — saldos QB virão na v2),
**Clients** (contratos signed com payment milestones), **Subs**
(espelho pros agreements).

**Modelo de dados** (migration 026):
- `bank_accounts` — lista das contas da empresa (CRUD inline na própria
  Finance via botão "Bank Accounts" no header).
- `payment_milestones` — uma row por parcela. Materializadas a partir
  do JSONB `contracts.payment_plan` quando o contrato é assinado (via
  webhook DocuSign) ou no primeiro acesso à Finance (defensive
  `ensureMilestonesForContract` se a row não existe).
- `sub_payments` — espelho reverso pros `subcontractor_agreements`
  (mesma lógica via `ensureSubPaymentsForAgreement`).

Status enum: `pending | partial | paid`. **Overdue nunca é guardado**
— é projeção UI a partir de `due_date < hoje - 3 dias` (regra: 3 dias
de carência conforme pedido). Pagamento parcial fica na MESMA
milestone (received_amount acumula até atingir due_amount).

**Plug-ins novos:**
- `api/docusign-webhook.js` — ao receber signed/completed, invoca
  `materializePaymentMilestones` (contrato) ou `materializeSubPayments`
  (agreement) inline. Idempotente. Falha silenciosa não bloqueia o
  signing.
- `src/shared/lib/finance.js` — helpers compartilhados: `effectiveStatus`,
  `milestoneAmount`, `ensureMilestonesForContract`, `markMilestoneReceived`,
  `ensureSubPaymentsForAgreement`, `markSubPaymentPaid`, `loadFinanceTotals`.
- Audit log via `audit_log` em toda mark-received / mark-paid /
  bank_account.create / update / activate / deactivate.

**Pendências do Ramon antes de testar em produção:**
- Rodar **migration 026** no Supabase (`migrations/026_finance.sql`).
- (Opcional, próxima onda) Setup OAuth do QuickBooks pra v2.

**Sprint 2 do Finance — adiada pra outra rodada:**
- QuickBooks read-only (saldos das 3 contas).
- Lembretes automáticos (cron Vercel + notification in-app).
- Tab Company com mais agregados (gráficos? evolução mensal?).

**2026-04-30 (tarde — username login)** — Ramon + Claude (Opus 4.7).
Início da Fase 3 do auth track (auth hardening), parcial e
retrocompatível:

- **Migration 025** — adiciona `username` em `users` (nullable,
  unique-via-`lower()` index). Login agora pede username em vez de
  free-text "Your Name", validado contra `users.username + pin`.
- **Login.jsx — lookup com 3 fallbacks** (em ordem):
  1. `username + pin` — caminho ideal, users cadastrados pelo admin.
  2. `name ilike + pin` — legacy: rows existentes sem username (Brenda).
  3. `PIN_TO_ROLE` hardcoded — quem ainda não foi cadastrado.
  Tudo retrocompatível, ninguém é trancado fora.
- **Admin → Users & Access** ganhou campo **Username (login)**
  (obrigatório em "Add User", opcional em "Edit"). Validação:
  `[a-z0-9._]{3,32}`, lowercase forçado, sem espaço. Catch específico
  pra erro de unique violation (23505) → "That username is already
  taken". Tabela ganhou coluna **Username**.
- **Roles do select** ajustados: removido `admin` (regra "admin é
  hardcoded, nunca em users"); adicionados `receptionist`,
  `marketing`, `screen` (TV Dashboard) que faltavam.

**Pendência do Ramon antes de testar em prod:**
- Rodar **migration 025** no Supabase (`migrations/025_user_username.sql`).
  Sem isso, lookup (1) falha silenciosamente, login cai pra (2)/(3)
  e o app não quebra — só significa que o feature de username não
  funciona até a migration estar no banco.

**2026-04-30** — Ramon + Claude (Opus 4.7).
Sessão focada em finalizar o profile dos usuários antes do cadastro
real da equipe. Mudanças:

- **Sidebars com avatar do user logado** (5 arquivos: owner, admin,
  manager, operations, receptionist). Foto vem de
  `users.profile_photo_url` via novo hook compartilhado
  `src/shared/hooks/useUserProfile.js`. Quando não tem foto, fallback
  pra inicial colorida via `colorFromName(name)`. UserProfileModal
  passa `onUserUpdated={refresh}` pra atualizar a sidebar
  imediatamente quando user troca a foto.
- **Admin → Users & Access expandido** (`src/apps/admin/screens/UsersAccess.jsx`).
  Form agora tem **Full Name, Role, Phone, Address, Profile Photo +
  PIN**. Upload reutiliza pipeline do `UserProfileModal`
  (`browser-image-compression` em Web Worker, target 2 MB, max 1024px,
  hard-cap 4 MB). Pra "new user" o file fica pendente em state e sobe
  depois do insert (precisa do user.id pra path). Tabela ganhou
  coluna **Phone** + thumbnail circular do avatar do lado de cada
  nome (igual aparece no chat).
- **Migrations 021 + 024 + bucket `user-profiles`** confirmados em
  produção (Ramon rodou). Removido das pendências.

Commits anteriores que ficaram fora do CLAUDE.md (29/04 final → 30/04):
- `5a19e68 feat(contract)` — full editable Omega contract template + PDF download
- `85de39a fix(estimate)` — autofill button always works (starter pack fallback)
- `f6c1bbb feat(estimate)` — full autofill coverage (flooring + 7 starter packs)

**Pendências do Ramon agora:**
- Cadastrar todos os usuários reais em **Admin → Users & Access** (form
  novo já aceita foto + phone + address). Preparação pra Fase 3 do
  auth track (auth hardening — remove fallback `PIN_TO_ROLE`).
- `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` na Vercel + scope
  `users:read` no Slack App (continua pendente desde 29/04).

**2026-04-29 (madrugada — fim de verdade)** — Ramon + Claude (Opus 4.7).
Conserto definitivo do bug do HTML literal no chat (`78d709a`). Causa
era ordem de operações no `renderSlackMrkdwn` — pipeline gerava `<a>`
nos passes 3-4 e o passe 5 (`<` → `&lt;`) destruía. Solução com
placeholder tokens (U+0000 NUL como sentinela). 7 tentativas anteriores
chasing the wrong cause foram registradas em "Bugs conhecidos" como
lição pra próximas pipelines de markdown→HTML. Bug fechado.

**2026-04-29 (fim do dia)** — Ramon + Claude (Opus 4.7).
Sessão muito longa — 22 commits. Resumo do que ficou em produção:

- **Logo, viewports, sidebars** — centralização de `src/assets/logo.png`,
  decisão de viewport por role (Attila/Gabriel = tablet,
  Receptionist = iPad/PC, resto = desktop), sidebars independentes
  por role.
- **Calendar redesign** (Sprint 2C) — header novo, eventos como pílulas,
  painel direito com Today/Upcoming/MiniCalendar, FiltersMenu popover.
- **Pipeline redesign** (Sprint 2D) — cards landscape com cover photo
  (migration 021 + bucket `job-covers`), badge de serviço na cor da
  coluna, total $ por coluna.
- **Subcontractor redesign** — `name` virou Company Name + novo campo
  `contact_name` (migration 022). Card mostra contato em destaque,
  empresa cinza embaixo. Helper `subInlineLabel()` aplicado em
  todos os 6 lugares onde sub aparece (manager, dropdown, twilio
  templates, sub-offer, jarvis).
- **Slack chat por projeto (Sprints 1-4 do roadmap)** —
  `api/slack/{get-messages,send-message,file-proxy}.js`, helpers em
  `api/_lib/`, migration 023 + bucket `job-covers` reaproveitado,
  componente `ProjectChat.jsx` na aba Daily Logs. Polling 30s,
  text + image upload com auto-compressão (browser-image-compression),
  thumbnails inline via proxy, mention pills, system message rows,
  outbound-link confirmation modal, date separators, color por autor,
  user profile photos resolvidos por nome.
- **Profile modal** (Fase 2 do auth track) — migration 024 + bucket
  `user-profiles`, click em "INACIO" / "BRENDA" / etc na sidebar abre
  modal com phone/address/photo. Photos aparecem nos avatares do chat
  via name-match contra `users.name`.
- **Lead sources** — adicionados Houzz e Mr.NailEdit; "Angie's List"
  renomeado pra "Angi" (rebrand oficial).

**Pendências de Ramon** (uma vez só, fora do código):
- Rodar migrations 021, 022, 023, 024 no Supabase
- Criar buckets `job-covers` e `user-profiles` (PUBLIC) com policies
- Setar `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` na Vercel
- Adicionar scope `users:read` no Slack App
- Cadastrar todos os usuários reais em Admin → Users & Access
  (preparação pra Fase 3 — auth hardening)

**Bug aberto pra retomar:** ver "🔴 Slack chat: mensagens postadas via
app aparecem com HTML literal" na seção Bugs Conhecidos. 6 tentativas
de fix (regex de várias formas, DOMParser) não resolveram. Plano pra
amanhã: capturar o `text` exato vindo da Slack API via DevTools e
considerar sanitização server-side.

**Pendência futura:** Fase 3 (auth hardening) — fechado parcialmente
em 30/04 (ver "tarde — username login"). Falta remover o fallback
`PIN_TO_ROLE` hardcoded e o lookup (2) por `name ilike + pin`,
deixando só `username + pin`. Adiar até toda a equipe estar
cadastrada com username em `users`.

**2026-04-29 (manhã)** — Ramon + Claude (Opus 4.7).
Logo centralizada em `src/assets/logo.png` (deletadas 5 cópias
duplicadas em `src/apps/<role>/assets/`). Adicionada tabela de
**viewports por role**. Registrada decisão: **sidebars são
independentes por role**. Adicionada feature **"Chat via Slack"** no
roadmap (planejamento concluído, Sprint 1 pendente).

**2026-04-28** — Ramon + Claude (Opus 4.7).
Reescrita completa do CLAUDE.md baseada na análise do estado real do
repo: stack, 8 papéis em `src/apps/`, 20 migrations, Vercel cron,
auto-deploy via GitHub, identidade Git global, trabalho híbrido em duas
máquinas, decisões de arquitetura consolidadas.
