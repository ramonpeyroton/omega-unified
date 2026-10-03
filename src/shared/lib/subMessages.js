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
