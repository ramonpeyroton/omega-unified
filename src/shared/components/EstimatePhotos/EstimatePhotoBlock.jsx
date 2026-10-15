// Client side of estimate photos (migration 089) — the public estimate,
// alternatives and bundle pages. Inline styles like the rest of those
// pages, so html2pdf ("Download PDF") renders them as shown. Photos sit two
// per row; PDF pages (plans, drawings) get the full width so measurements
// stay readable. Clicking opens the full-screen viewer at that photo
// (`onOpen(photo)` — the page owns one viewer for every photo).
//
// Laid out as rows (2 photos, or 1 PDF page) so the PDF's page-break pass
// moves a whole row to the next page instead of cutting it. The heading
// (`title` text or a ready `header` element) rides inside the first row, so
// it never ends up alone at the bottom of a page.
const AVOID = { pageBreakInside: 'avoid', breakInside: 'avoid' };

export default function EstimatePhotoBlock({ photos, title, header, onOpen, compact = false }) {
  const list = (photos || []).filter((p) => p?.url);
  if (!list.length) return null;
  const pages = list.filter((p) => p.kind === 'pdf_page');
  const pics = list.filter((p) => p.kind !== 'pdf_page');
  const cap = { fontSize: compact ? 11 : 12, color: '#555', marginTop: 4, lineHeight: 1.4 };
  const zoom = onOpen ? 'zoom-in' : 'default';

  const rows = [];
  for (let i = 0; i < pics.length; i += 2) rows.push({ type: 'pics', items: pics.slice(i, i + 2) });
  pages.forEach((p) => rows.push({ type: 'page', items: [p] }));

  const heading = header || (title && (
    <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700, marginBottom: 8 }}>
      {title}
    </div>
  ));

  return (
    <div style={{ marginTop: compact ? 10 : 14 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ ...AVOID, marginTop: ri ? 10 : 0 }}>
          {ri === 0 && heading}
          {row.type === 'pics' ? (
            <div style={{ display: 'flex', gap: 10 }}>
              {row.items.map((p) => (
                <figure key={p.id || p.url} style={pics.length === 1
                  ? { margin: 0, maxWidth: '70%' }
                  : { margin: 0, width: 'calc(50% - 5px)' }}>
                  <img
                    src={p.url}
                    alt={p.caption || 'Photo'}
                    onClick={() => onOpen?.(p)}
                    // Natural proportions (no object-fit) — html2pdf ignores
                    // object-fit and would stretch the photo in the PDF. The
                    // height cap keeps a portrait photo from eating a page.
                    style={{ display: 'block', width: 'auto', maxWidth: '100%', height: 'auto', maxHeight: compact ? 300 : 420, borderRadius: 6, border: '1px solid #eee', cursor: zoom }}
                  />
                  {p.caption && <figcaption style={cap}>{p.caption}</figcaption>}
                </figure>
              ))}
            </div>
          ) : (
            row.items.map((p) => (
              <figure key={p.id || p.url} style={{ margin: 0 }}>
                <img
                  src={p.url}
                  alt={p.caption || 'Document page'}
                  onClick={() => onOpen?.(p)}
                  // Capped so heading + one plan page + caption fit one letter page
                  // (~905px of content at this width) — taller and the page-break
                  // pass gives up on keeping the row whole.
                  style={{ display: 'block', width: 'auto', maxWidth: '100%', height: 'auto', maxHeight: compact ? 640 : 780, margin: '0 auto', borderRadius: 6, border: '1px solid #e5e5e5', background: 'white', cursor: zoom }}
                />
                {p.caption && <figcaption style={cap}>{p.caption}</figcaption>}
              </figure>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
