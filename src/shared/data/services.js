// Canonical list of services Omega offers. Lives in shared/ so any
// app can import it without reaching into another app's folder.
// `apps/sales/data/questionnaire.js` re-exports from here for back-compat
// with the existing `import { SERVICES } from '.../questionnaire'` calls.
//
// `id` is the value persisted to `jobs.service` (comma-separated when
// a job has more than one). `label` is the human-readable text shown
// on cards and forms. `icon` is a lucide-react component name.

export const SERVICES = [
  { id: 'bathroom',        label: 'Bathroom Renovation', icon: 'Droplets' },
  { id: 'kitchen',         label: 'Kitchen Renovation',  icon: 'ChefHat' },
  { id: 'deck',            label: 'Deck / Patio',        icon: 'TreePine' },
  { id: 'addition',        label: 'Home Addition',       icon: 'Home' },
  { id: 'roofing',         label: 'Roofing',             icon: 'Triangle' },
  { id: 'driveway',        label: 'Driveway',            icon: 'Car' },
  { id: 'basement',        label: 'Basement Finishing',  icon: 'Layers' },
  { id: 'flooring',        label: 'Flooring',            icon: 'Grid3x3' },
  { id: 'survey',          label: 'Survey',              icon: 'Ruler' },
  { id: 'building_plans',  label: 'Building Plans',      icon: 'DraftingCompass' },
  { id: 'partialreno',     label: 'Partial Renovation',  icon: 'Wrench' },
  { id: 'fullreno',        label: 'Full Renovation',     icon: 'Building2' },
  { id: 'newconstruction', label: 'New Construction',    icon: 'Building' },
];

// Quick lookup: id → label.
export const SERVICE_LABEL = Object.fromEntries(SERVICES.map((s) => [s.id, s.label]));

// Parse the comma-separated string we persist on jobs.service into an
// array of ids. Tolerates whitespace, empty strings, and the legacy
// case where the column held labels instead of ids (matches by label
// case-insensitively as a last resort).
export function parseJobServices(value) {
  if (!value) return [];
  const tokens = String(value).split(',').map((t) => t.trim()).filter(Boolean);
  const idSet = new Set(SERVICES.map((s) => s.id));
  return tokens.map((tok) => {
    if (idSet.has(tok)) return tok;
    const byLabel = SERVICES.find((s) => s.label.toLowerCase() === tok.toLowerCase());
    return byLabel ? byLabel.id : tok; // unknown values stay untouched so we don't lose data
  });
}

// Inverse of parseJobServices — joins ids back to the canonical
// comma-separated form for storage.
export function joinJobServices(ids) {
  return (ids || []).filter(Boolean).join(', ');
}
