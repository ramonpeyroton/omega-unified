// Copy of a page section ready for html2pdf, minus the `.no-print` bits
// (toolbar with Close / Print / Download PDF, etc).
//
// Why not html2canvas `ignoreElements`: html2pdf works out its page breaks
// on the layout WITH those elements, then html2canvas draws WITHOUT them —
// everything slides up by the toolbar's height (~64px) and headers land
// alone at the bottom of a page. Removing them before html2pdf measures
// keeps both passes on the same layout.
export function printableClone(el) {
  const copy = el.cloneNode(true);
  // cloneNode leaves canvases blank (a signature being drawn, a chart) —
  // copy their pixels over before anything is removed, while the order of
  // canvases still matches the original.
  const src = el.querySelectorAll('canvas');
  copy.querySelectorAll('canvas').forEach((c, i) => {
    try { c.getContext('2d')?.drawImage(src[i], 0, 0); } catch { /* tainted / empty */ }
  });
  copy.querySelectorAll('.no-print').forEach((n) => n.remove());
  return copy;
}
