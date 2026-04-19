// Shared renderer for AI-generated reports that follow the
// `###SECTION###<KEY>\n<body>` convention used by Sales' Report generator.
// Also renders plain markdown (headings, bullets, tables, bold) when the
// input has no section markers.

const SECTION_META = {
  OVERVIEW:         { title: 'Overview',             accent: 'blue' },
  SCOPE:            { title: 'Scope of Work',        accent: 'charcoal' },
  SELECTIONS:       { title: 'Selections',           accent: 'green' },
  MISSING_INFO:     { title: 'Missing Information',  accent: 'amber' },
  RED_FLAGS:        { title: 'Red Flags',            accent: 'red' },
  CT_CODE:          { title: 'CT Building Code',     accent: 'blue' },
  PERMITS:          { title: 'Permits',              accent: 'amber' },
  TRADES:           { title: 'Trades Required',      accent: 'charcoal' },
  UPSELLS:          { title: 'Upsell Opportunities', accent: 'green' },
  ESTIMATING_NOTES: { title: 'Estimating Notes',     accent: 'stone' },
  PHASE_BREAKDOWN:  { title: 'Phase Breakdown',      accent: 'charcoal' },
};

const ACCENT_STYLES = {
  blue:     { bar: 'bg-blue-500',     bg: 'bg-blue-50/50',     text: 'text-blue-900' },
  green:    { bar: 'bg-green-500',    bg: 'bg-green-50/50',    text: 'text-green-900' },
  amber:    { bar: 'bg-amber-500',    bg: 'bg-amber-50/50',    text: 'text-amber-900' },
  red:      { bar: 'bg-red-500',      bg: 'bg-red-50/50',      text: 'text-red-900' },
  charcoal: { bar: 'bg-omega-charcoal', bg: 'bg-omega-cloud',  text: 'text-omega-charcoal' },
  stone:    { bar: 'bg-omega-stone',  bg: 'bg-gray-50',        text: 'text-omega-slate' },
};

export function parseReport(raw) {
  if (!raw) return [];
  const parts = raw.split('###SECTION###');
  if (parts.length <= 1) {
    // Not section-formatted — return as a single pseudo-section
    return [{ key: 'BODY', title: null, accent: 'charcoal', content: raw.trim() }];
  }
  return parts
    .slice(1)
    .map((part) => {
      const newline = part.indexOf('\n');
      if (newline < 0) return null;
      const key = part.substring(0, newline).trim();
      const content = part.substring(newline + 1).trim();
      const meta = SECTION_META[key] || { title: key.replace(/_/g, ' '), accent: 'charcoal' };
      return { key, ...meta, content };
    })
    .filter((s) => s && s.content);
}

export function renderInline(text) {
  if (!text) return text;
  const parts = String(text).split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('***') && part.endsWith('***'))
      return <strong key={i}><em>{part.slice(3, -3)}</em></strong>;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-omega-charcoal">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function renderMarkdownBlocks(content) {
  if (!content) return null;
  const lines = content.split('\n');
  const elements = [];
  let i = 0;
  let ulItems = [];
  let olItems = [];

  function flushLists() {
    if (ulItems.length) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-2 space-y-1 ml-1">
          {ulItems.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-omega-slate leading-relaxed">
              <span className="text-omega-orange mt-0.5 flex-shrink-0 select-none">•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      ulItems = [];
    }
    if (olItems.length) {
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-2 space-y-1 ml-1 list-none">
          {olItems.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-omega-slate leading-relaxed">
              <span className="text-omega-orange font-semibold flex-shrink-0 select-none w-5 text-right">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      olItems = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushLists();
      i++;
      continue;
    }

    // Markdown table
    if (trimmed.startsWith('|')) {
      flushLists();
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const dataRows = tableLines.filter((l) => !/^\|[\s\-:|]+\|$/.test(l));
      const rows = dataRows.map((l) =>
        l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      );
      if (rows.length > 0) {
        elements.push(
          <div key={`tbl-${elements.length}`} className="overflow-x-auto my-3 rounded-lg border border-gray-200">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  {rows[0].map((cell, ci) => (
                    <th key={ci} className="px-3 py-2 text-left text-xs font-semibold text-omega-stone uppercase tracking-wider whitespace-nowrap">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((row, ri) => (
                  <tr key={ri} className={`border-b border-gray-100 last:border-0 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-sm text-omega-slate">{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      flushLists();
      elements.push(
        <h3 key={`h3-${i}`} className="font-bold text-omega-charcoal text-sm mt-4 mb-1.5 pb-1 border-b border-gray-200">
          {renderInline(trimmed.replace(/^###\s+/, ''))}
        </h3>
      );
      i++; continue;
    }
    if (trimmed.startsWith('## ')) {
      flushLists();
      elements.push(
        <h2 key={`h2-${i}`} className="font-bold text-omega-charcoal text-base mt-4 mb-1.5">
          {renderInline(trimmed.replace(/^##\s+/, ''))}
        </h2>
      );
      i++; continue;
    }
    if (trimmed.startsWith('# ')) {
      flushLists();
      elements.push(
        <h1 key={`h1-${i}`} className="font-bold text-omega-charcoal text-lg mt-4 mb-1.5">
          {renderInline(trimmed.replace(/^#\s+/, ''))}
        </h1>
      );
      i++; continue;
    }

    // Bullets
    if (/^[-*•]\s/.test(trimmed)) {
      if (olItems.length) flushLists();
      ulItems.push(trimmed.replace(/^[-*•]\s/, ''));
      i++; continue;
    }

    // Numbered lists
    if (/^\d+[.)]\s/.test(trimmed)) {
      if (ulItems.length) flushLists();
      olItems.push(trimmed.replace(/^\d+[.)]\s/, ''));
      i++; continue;
    }

    // Bold-line pseudo-heading
    if (/^\*\*[^*]+\*\*[:\s]*$/.test(trimmed)) {
      flushLists();
      elements.push(
        <p key={`bh-${i}`} className="font-bold text-omega-charcoal mt-3 mb-1 text-sm">
          {trimmed.replace(/\*\*/g, '')}
        </p>
      );
      i++; continue;
    }

    // Plain paragraph
    flushLists();
    elements.push(
      <p key={`p-${i}`} className="text-sm text-omega-slate leading-relaxed">
        {renderInline(trimmed)}
      </p>
    );
    i++;
  }
  flushLists();
  return elements;
}

/**
 * Render a parsed report section as a styled card.
 */
function SectionCard({ section }) {
  const accent = ACCENT_STYLES[section.accent] || ACCENT_STYLES.charcoal;
  return (
    <section className={`rounded-xl border border-gray-200 overflow-hidden bg-white`}>
      {section.title && (
        <div className={`flex items-stretch border-b border-gray-200`}>
          <div className={`w-1 ${accent.bar}`} />
          <div className={`flex-1 px-4 py-2.5 ${accent.bg}`}>
            <p className={`text-xs font-bold uppercase tracking-wider ${accent.text}`}>{section.title}</p>
          </div>
        </div>
      )}
      <div className="px-4 py-3">
        {renderMarkdownBlocks(section.content)}
      </div>
    </section>
  );
}

/**
 * Full report renderer. Accepts raw text in Omega section format
 * (`###SECTION###KEY\nbody`) or plain markdown.
 *
 * Usage:
 *   <MarkdownReport raw={job.latest_report} />
 */
export default function MarkdownReport({ raw }) {
  const sections = parseReport(raw);
  if (sections.length === 0) {
    return <p className="text-sm text-omega-stone italic">No content to display.</p>;
  }
  return (
    <div className="space-y-3">
      {sections.map((section, i) => (
        <SectionCard key={`${section.key}-${i}`} section={section} />
      ))}
    </div>
  );
}
