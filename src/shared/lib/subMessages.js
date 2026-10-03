// Every message the app writes TO a subcontractor goes through here, in the
// sub's primary language (subcontractors.preferred_language: 'en' | 'pt' |
// 'es', migration 020). The internal app stays English — only text that
// reaches the sub is translated. Phase names, checklist items and job
// services are typed in English in the app and stay as typed.
//
// The sub-offer SMS + public Accept/Reject page keep their own copies
// (JobSubcontractorsSection.buildOfferSMS, SubOfferView I18N).

import { SERVICE_LABEL, parseJobServices, serviceBadgeLabel } from '../data/services';

// 'kitchen' → 'Kitchen Renovation' ('bathroom, deck' → both).
const serviceText = (value) =>
  parseJobServices(value).map((id) => SERVICE_LABEL[id] || serviceBadgeLabel(id)).join(', ');

export const SUB_LANGUAGES = [
  { value: 'en', label: 'English',   short: 'EN' },
  { value: 'pt', label: 'Português', short: 'PT' },
  { value: 'es', label: 'Español',   short: 'ES' },
];

export function subLanguage(sub) {
  const v = String(sub?.preferred_language || '').toLowerCase();
  return SUB_LANGUAGES.some((l) => l.value === v) ? v : 'en';
}

export function subLanguageLabel(sub) {
  return SUB_LANGUAGES.find((l) => l.value === subLanguage(sub))?.label || 'English';
}

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Rows from the legacy job_subs table only carry sub_name / sub_phone —
// find the sub on file by phone so we still know its language.
export function findSubByPhone(subs, phone) {
  const d = digits(phone);
  if (!d) return null;
  return (subs || []).find((s) => digits(s.phone) === d) || null;
}

const T = {
  en: {
    hi: (n) => `Hi ${n}, this is Omega Development.`,
    phase: 'Phase', client: 'Client', address: 'Address', service: 'Service',
    confirmAsk: 'Can you confirm your availability for this work? Reply YES to confirm or call us if you need to discuss timing.',
    thanks: 'Thanks!',
    reworkHi: (n) => `Hi ${n}, quick note from Omega field:`,
    job: 'Job',
    reworkItem: (kind) => `Item needing ${kind === 'fail' ? 'rework' : 'a fix'}`,
    reworkAsk: 'Please reach out so we can coordinate. Thanks!',
    assignHi: (n) => `Hi ${n}! 👷`,
    assignIntro: "You've been assigned to a project with Omega Development.",
    location: 'Location', start: 'Start', at: 'at',
    scope: 'Your scope of work:', scopeOnSite: 'Tasks will be provided on site',
    tools: 'Tools to bring:',
    assignAsk: 'Please confirm your availability by replying.',
    assignThanks: 'Thank you for being part of the Omega team! 🏗️',
  },
  pt: {
    hi: (n) => `Olá ${n}, aqui é a Omega Development.`,
    phase: 'Etapa', client: 'Cliente', address: 'Endereço', service: 'Serviço',
    confirmAsk: 'Você pode confirmar sua disponibilidade para esse trabalho? Responda SIM para confirmar ou ligue pra gente se precisar conversar sobre as datas.',
    thanks: 'Obrigado!',
    reworkHi: (n) => `Olá ${n}, um recado da equipe de campo da Omega:`,
    job: 'Obra',
    reworkItem: (kind) => `Item que precisa de ${kind === 'fail' ? 'retrabalho' : 'ajuste'}`,
    reworkAsk: 'Por favor, entre em contato pra gente combinar. Obrigado!',
    assignHi: (n) => `Olá ${n}! 👷`,
    assignIntro: 'Você foi escalado para uma obra da Omega Development.',
    location: 'Local', start: 'Início', at: 'às',
    scope: 'Seu escopo de trabalho:', scopeOnSite: 'As tarefas serão passadas na obra',
    tools: 'Ferramentas para levar:',
    assignAsk: 'Por favor, confirme sua disponibilidade respondendo esta mensagem.',
    assignThanks: 'Obrigado por fazer parte do time Omega! 🏗️',
  },
  es: {
    hi: (n) => `Hola ${n}, le escribe Omega Development.`,
    phase: 'Etapa', client: 'Cliente', address: 'Dirección', service: 'Servicio',
    confirmAsk: '¿Puede confirmar su disponibilidad para este trabajo? Responda SÍ para confirmar o llámenos si necesita hablar sobre las fechas.',
    thanks: '¡Gracias!',
    reworkHi: (n) => `Hola ${n}, una nota del equipo de campo de Omega:`,
    job: 'Obra',
    reworkItem: (kind) => `Punto que necesita ${kind === 'fail' ? 'retrabajo' : 'un ajuste'}`,
    reworkAsk: 'Por favor comuníquese con nosotros para coordinar. ¡Gracias!',
    assignHi: (n) => `¡Hola ${n}! 👷`,
    assignIntro: 'Ha sido asignado a un proyecto de Omega Development.',
    location: 'Ubicación', start: 'Inicio', at: 'a las',
    scope: 'Su alcance de trabajo:', scopeOnSite: 'Las tareas se darán en la obra',
    tools: 'Herramientas que debe traer:',
    assignAsk: 'Por favor confirme su disponibilidad respondiendo este mensaje.',
    assignThanks: '¡Gracias por ser parte del equipo Omega! 🏗️',
  },
};

const t = (lang) => T[lang] || T.en;
// Contact person first ("Hi Pedro"), not the LLC.
const greetName = (sub) => (sub?.contact_name || sub?.name || sub?.sub_name || '').trim();

/** "Please confirm" for one phase — Contact button on Phases / Contact tab. */
export function subConfirmTemplate({ sub, phase, job, lang }) {
  const L = t(lang || subLanguage(sub));
  const lines = [L.hi(greetName(sub))];
  if (phase?.name)      lines.push(`${L.phase}: ${phase.name}`);
  if (job?.client_name) lines.push(`${L.client}: ${job.client_name}`);
  if (job?.address)     lines.push(`${L.address}: ${job.address}`);
  if (job?.service)     lines.push(`${L.service}: ${serviceText(job.service) || job.service}`);
  lines.push('', L.confirmAsk, '', L.thanks);
  return lines.join('\n');
}

/** WhatsApp sent when an item is marked Fail / Fix on the Phases tab. */
export function subReworkMessage({ sub, job, phase, item, kind, lang }) {
  const L = t(lang || subLanguage(sub));
  return [
    L.reworkHi(greetName(sub)),
    '',
    `${L.job}: ${job?.client_name || ''}`,
    `${L.phase}: ${phase?.name || ''}`,
    `${L.reworkItem(kind)}: ${item?.label || ''}`,
    '',
    L.reworkAsk,
  ].join('\n');
}

/** Owner → Assign Subs: "you've been assigned" with scope + tools. */
export function subAssignedMessage({ sub, lang, phaseName, tasks, toolList, jobAddress, startDate, startTime }) {
  const L = t(lang || subLanguage(sub));
  const taskList = (tasks || []).filter((x) => !x.startsWith('__')).map((x) => `• ${x}`).join('\n');
  const dateStr = startDate ? `📅 ${L.start}: ${startDate}${startTime ? ` ${L.at} ${startTime}` : ''}` : '';
  return `${L.assignHi(greetName(sub))}

${L.assignIntro}

📍 ${L.location}: ${jobAddress}${dateStr ? `\n${dateStr}` : ''}
🔨 ${L.phase}: ${phaseName}

${L.scope}
${taskList || `• ${L.scopeOnSite}`}

🧰 ${L.tools}
${toolList}

${L.assignAsk}
${L.assignThanks}

— Omega Development
📞 203-451-4846
🌐 omeganyct.com`;
}

// ─── Job schedule (Phases → "Send schedule to subs") ───────────────
// One SMS per sub with every phase + date it has on the job. Goes out
// from the Twilio number, which can't take replies — so it's signed by
// the owner and closes asking the sub to answer on his cell.

const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// 'YYYY-MM-DD' → "Mon 10/5" (en) · "seg 05/10" (pt) · "lun 05/10" (es)
function dayText(key, lang) {
  const [y, m, d] = key.split('-').map(Number);
  const wd = WEEKDAYS[lang][new Date(y, m - 1, d).getDay()];
  if (lang === 'en') return `${wd} ${m}/${d}`;
  return `${wd} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

const S = {
  en: {
    open: (n, s, client, svc) => `Hi ${n}! This is ${s} from Omega Development. Here is your schedule for the ${client} job${svc ? ` (${svc})` : ''}:`,
    range: (a, b) => `${a} – ${b}`,
    tbd: 'date TBD',
    confirm: 'Please confirm these dates.',
    noReply: (p) => `⚠️ Please don't reply to this message, this number doesn't receive replies. Text or call me on my cell: ${p}.`,
    thanks: 'Thanks!',
  },
  pt: {
    open: (n, s, client, svc) => `Olá ${n}! Aqui é o ${s}, da Omega Development. Segue sua agenda na obra da ${client}${svc ? ` (${svc})` : ''}:`,
    range: (a, b) => `${a} a ${b}`,
    tbd: 'data a definir',
    confirm: 'Por favor, confirme essas datas.',
    noReply: (p) => `⚠️ Não responda esta mensagem, este número não recebe respostas. Fale comigo no meu celular: ${p}.`,
    thanks: 'Obrigado!',
  },
  es: {
    open: (n, s, client, svc) => `¡Hola ${n}! Le escribe ${s}, de Omega Development. Esta es su agenda en la obra de ${client}${svc ? ` (${svc})` : ''}:`,
    range: (a, b) => `${a} al ${b}`,
    tbd: 'fecha por definir',
    confirm: 'Por favor confirme estas fechas.',
    noReply: (p) => `⚠️ No responda a este mensaje, este número no recibe respuestas. Comuníquese conmigo a mi celular: ${p}.`,
    thanks: '¡Gracias!',
  },
};

export function prettyPhone(raw) {
  const d = digits(raw);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(raw || '').trim();
}

/**
 * @param entries [{ phase, start_date, end_date }] — this sub's slots
 * @param signer  name that signs (the owner)
 * @param replyPhone the signer's cell, where the sub should answer
 */
export function subScheduleMessage({ sub, job, entries, signer, replyPhone, lang }) {
  const lg = WEEKDAYS[lang] ? lang : subLanguage(sub);
  const L = S[lg];
  const lines = [L.open(greetName(sub), signer, job?.client_name || '', job?.service ? serviceText(job.service) : ''), ''];
  if (job?.address) lines.push(`📍 ${job.address}`, '');
  for (const e of entries) {
    let when = L.tbd;
    if (e.start_date && e.end_date && e.end_date !== e.start_date) {
      when = L.range(dayText(e.start_date, lg), dayText(e.end_date, lg));
    } else if (e.start_date || e.end_date) {
      when = dayText(e.start_date || e.end_date, lg);
    }
    lines.push(`• ${cap(when)}: ${e.phase}`);
  }
  lines.push('', L.confirm);
  if (replyPhone) lines.push(L.noReply(prettyPhone(replyPhone)));
  lines.push('', L.thanks, `${signer} — Omega Development`);
  return lines.join('\n');
}
