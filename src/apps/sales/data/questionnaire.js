// ════════════════════════════════════════════════════════════════════
// OMEGA — Smart conditional questionnaire
// Each service defines an ORDERED list of questions. Questions with a
// `showIf(answers)` predicate appear/disappear dynamically based on
// earlier answers. The UI presents ONE visible question at a time.
// ════════════════════════════════════════════════════════════════════

export const SERVICES = [
  { id: 'bathroom',        label: 'Bathroom Renovation', icon: 'Droplets' },
  { id: 'kitchen',         label: 'Kitchen Renovation',  icon: 'ChefHat' },
  { id: 'deck',            label: 'Deck / Patio',        icon: 'TreePine' },
  { id: 'addition',        label: 'Home Addition',       icon: 'Home' },
  { id: 'roofing',         label: 'Roofing',             icon: 'Triangle' },
  { id: 'driveway',        label: 'Driveway',            icon: 'Car' },
  { id: 'basement',        label: 'Basement Finishing',  icon: 'Layers' },
  { id: 'fullreno',        label: 'Full Renovation',     icon: 'Building2' },
  { id: 'newconstruction', label: 'New Construction',    icon: 'Building' },
];

// ─── Question type reference ────────────────────────────────────────
// { id, type, label, helper?, options?, unit?, placeholder?, showIf? }
// - single     : large buttons, one choice — auto-advances on click
// - multi      : large buttons, many choices — needs Continue
// - dimensions : two number inputs (width x length) with unit
// - number     : single number input
// - text       : textarea
// ─────────────────────────────────────────────────────────────────────

// Bathroom — shower exists if: no tub, OR tub removed
const bathroomHasShower = (a) =>
  a.bath_has_tub === 'no' ||
  (a.bath_has_tub === 'yes' && a.bath_tub_action === 'remove');

export const QUESTIONNAIRE_SCHEMAS = {
  // ─────────────────────────────────────────────────────────────────
  // BATHROOM
  // ─────────────────────────────────────────────────────────────────
  bathroom: [
    { id: 'bath_dims', type: 'dimensions', label: 'What are the bathroom dimensions?', unit: 'ft' },

    { id: 'bath_has_tub', type: 'single', label: 'Is there a bathtub today?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },

    { id: 'bath_tub_action', type: 'single', label: 'What to do with the bathtub?',
      options: [
        { value: 'keep',     label: 'Keep' },
        { value: 'refinish', label: 'Refinish' },
        { value: 'remove',   label: 'Remove' },
      ],
      showIf: (a) => a.bath_has_tub === 'yes' },

    { id: 'bath_tub_replace', type: 'single', label: 'Convert to walk-in shower or shower only?',
      options: [
        { value: 'walk_in', label: 'Walk-in Shower' },
        { value: 'shower',  label: 'Shower only' },
      ],
      showIf: (a) => a.bath_has_tub === 'yes' && a.bath_tub_action === 'remove' },

    // Shower group (visible when there will be a shower)
    { id: 'bath_shower_dims', type: 'dimensions', label: 'Shower size', unit: 'ft',
      showIf: bathroomHasShower },

    { id: 'bath_drain', type: 'single', label: 'Drain position',
      options: [
        { value: 'center',        label: 'Center' },
        { value: 'linear_wall',   label: 'Linear — against wall' },
        { value: 'corner',        label: 'Corner' },
      ],
      showIf: bathroomHasShower },

    { id: 'bath_shower_tile', type: 'single', label: 'Shower tile material',
      options: [
        { value: 'porcelain',     label: 'Porcelain' },
        { value: 'ceramic',       label: 'Ceramic' },
        { value: 'natural_stone', label: 'Natural Stone' },
        { value: 'large_format',  label: 'Large Format' },
      ],
      showIf: bathroomHasShower },

    { id: 'bath_tile_height', type: 'single', label: 'Wall tile height',
      options: [
        { value: '4ft',         label: '4 ft' },
        { value: 'full_height', label: 'Full height' },
        { value: 'ceiling',     label: 'Up to ceiling' },
      ],
      showIf: bathroomHasShower },

    { id: 'bath_niche', type: 'single', label: 'Built-in niche?',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one',  label: '1 niche' },
        { value: 'two',  label: '2 niches' },
      ],
      showIf: bathroomHasShower },

    { id: 'bath_glass', type: 'single', label: 'Glass enclosure?',
      options: [
        { value: 'frameless',      label: 'Frameless' },
        { value: 'semi_frameless', label: 'Semi-frameless' },
        { value: 'curtain',        label: 'Curtain' },
      ],
      showIf: bathroomHasShower },

    { id: 'bath_bench', type: 'single', label: 'Built-in bench?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: bathroomHasShower },

    // Vanity
    { id: 'bath_vanity', type: 'single', label: 'Vanity',
      options: [
        { value: 'keep',     label: 'Keep' },
        { value: 'refinish', label: 'Refinish' },
        { value: 'replace',  label: 'Replace' },
      ] },

    { id: 'bath_vanity_sink', type: 'single', label: 'Single or double sink?',
      options: [{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }],
      showIf: (a) => a.bath_vanity === 'replace' },

    { id: 'bath_vanity_style', type: 'single', label: 'Vanity style',
      options: [
        { value: 'freestanding', label: 'Freestanding' },
        { value: 'floating',     label: 'Floating / wall-mount' },
        { value: 'built_in',     label: 'Built-in' },
      ],
      showIf: (a) => a.bath_vanity === 'replace' },

    // Toilet
    { id: 'bath_toilet', type: 'single', label: 'Toilet',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }] },

    // Floor
    { id: 'bath_floor', type: 'single', label: 'Floor',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }] },

    { id: 'bath_floor_material', type: 'single', label: 'Floor material',
      options: [
        { value: 'porcelain',     label: 'Porcelain' },
        { value: 'ceramic',       label: 'Ceramic' },
        { value: 'natural_stone', label: 'Natural Stone' },
        { value: 'lvp',           label: 'LVP' },
      ],
      showIf: (a) => a.bath_floor === 'replace' },

    { id: 'bath_heated_floor', type: 'single', label: 'Heated floor?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.bath_floor === 'replace' },

    // Lighting
    { id: 'bath_lighting', type: 'single', label: 'Lighting',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'update', label: 'Update' }] },

    { id: 'bath_recessed', type: 'single', label: 'Recessed lights?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.bath_lighting === 'update' },

    { id: 'bath_vanity_light', type: 'single', label: 'Vanity light?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.bath_lighting === 'update' },

    // Window
    { id: 'bath_has_window', type: 'single', label: 'Is there a window?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },

    { id: 'bath_window_action', type: 'single', label: 'Keep or replace the window?',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }],
      showIf: (a) => a.bath_has_window === 'yes' },

    // Demo
    { id: 'bath_demo', type: 'single', label: 'Demo scope',
      options: [{ value: 'full', label: 'Full demo' }, { value: 'partial', label: 'Partial demo' }] },

    { id: 'bath_demo_details', type: 'text', label: 'Specify which areas to demo',
      placeholder: 'e.g. tile only, fixtures, remove ceiling, etc.',
      showIf: (a) => a.bath_demo === 'partial' },

    // Permit
    { id: 'bath_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
  ],

  // ─────────────────────────────────────────────────────────────────
  // KITCHEN
  // ─────────────────────────────────────────────────────────────────
  kitchen: [
    { id: 'kitchen_dims', type: 'dimensions', label: 'Kitchen dimensions', unit: 'ft' },

    { id: 'kitchen_layout', type: 'single', label: 'Layout',
      options: [
        { value: 'keep',   label: 'Keep current layout' },
        { value: 'change', label: 'Change layout' },
      ] },

    { id: 'kitchen_open_wall', type: 'single', label: 'Open a wall?',
      options: [
        { value: 'yes',           label: 'Yes' },
        { value: 'no',            label: 'No' },
        { value: 'unsure_load',   label: "Don't know if load-bearing" },
      ],
      showIf: (a) => a.kitchen_layout === 'change' },

    { id: 'kitchen_island', type: 'single', label: 'Island',
      options: [
        { value: 'none',   label: "Don't have and don't want" },
        { value: 'keep',   label: 'Have and keep' },
        { value: 'remove', label: 'Have and remove' },
        { value: 'add',    label: 'Add new' },
      ] },

    // Cabinets
    { id: 'kitchen_cabinets', type: 'single', label: 'Cabinets',
      options: [
        { value: 'keep',     label: 'Keep' },
        { value: 'refinish', label: 'Refinish / Reface' },
        { value: 'replace',  label: 'Replace all' },
      ] },

    { id: 'kitchen_cabinet_material', type: 'single', label: 'Cabinet material',
      options: [
        { value: 'wood',        label: 'Wood' },
        { value: 'mdf_painted', label: 'MDF painted' },
        { value: 'thermofoil',  label: 'Thermofoil' },
      ],
      showIf: (a) => a.kitchen_cabinets === 'replace' },

    { id: 'kitchen_cabinet_color', type: 'single', label: 'Cabinet color',
      options: [
        { value: 'white',     label: 'White' },
        { value: 'off_white', label: 'Off-white' },
        { value: 'gray',      label: 'Gray' },
        { value: 'navy',      label: 'Navy' },
        { value: 'natural',   label: 'Natural wood' },
        { value: 'custom',    label: 'Custom' },
      ],
      showIf: (a) => a.kitchen_cabinets === 'replace' },

    { id: 'kitchen_cabinets_ceiling', type: 'single', label: 'Upper cabinets reach the ceiling?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No (space above)' },
      ],
      showIf: (a) => a.kitchen_cabinets === 'replace' },

    // Countertop
    { id: 'kitchen_countertop', type: 'single', label: 'Countertop',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }] },

    { id: 'kitchen_countertop_material', type: 'single', label: 'Countertop material',
      options: [
        { value: 'quartz',   label: 'Quartz' },
        { value: 'granite',  label: 'Granite' },
        { value: 'marble',   label: 'Marble' },
        { value: 'butcher',  label: 'Butcher block' },
        { value: 'laminate', label: 'Laminate' },
      ],
      showIf: (a) => a.kitchen_countertop === 'replace' },

    // Backsplash
    { id: 'kitchen_backsplash', type: 'single', label: 'Backsplash',
      options: [
        { value: 'none',   label: "Don't have and don't want" },
        { value: 'keep',   label: 'Keep' },
        { value: 'remove', label: 'Remove' },
        { value: 'new',    label: 'Install new' },
      ] },

    { id: 'kitchen_backsplash_style', type: 'single', label: 'Backsplash style',
      options: [
        { value: 'subway',        label: 'Subway tile' },
        { value: 'large_format',  label: 'Large format tile' },
        { value: 'natural_stone', label: 'Natural stone' },
        { value: 'full_height',   label: 'Full height' },
      ],
      showIf: (a) => a.kitchen_backsplash === 'new' },

    // Floor
    { id: 'kitchen_floor', type: 'single', label: 'Floor',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }] },

    { id: 'kitchen_floor_material', type: 'single', label: 'Floor material',
      options: [
        { value: 'hardwood',      label: 'Hardwood' },
        { value: 'lvp',           label: 'LVP' },
        { value: 'porcelain',     label: 'Porcelain tile' },
        { value: 'ceramic',       label: 'Ceramic' },
        { value: 'natural_stone', label: 'Natural Stone' },
      ],
      showIf: (a) => a.kitchen_floor === 'replace' },

    { id: 'kitchen_heated_floor', type: 'single', label: 'Heated floor?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.kitchen_floor === 'replace' },

    // Lighting
    { id: 'kitchen_lighting', type: 'single', label: 'Lighting',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'update', label: 'Update' }] },

    { id: 'kitchen_recessed', type: 'single', label: 'Recessed lights?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.kitchen_lighting === 'update' },

    { id: 'kitchen_under_cabinet', type: 'single', label: 'Under-cabinet lighting?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.kitchen_lighting === 'update' },

    { id: 'kitchen_pendants', type: 'single', label: 'Pendant lights over island?',
      options: [
        { value: 'yes',        label: 'Yes' },
        { value: 'no',         label: 'No' },
        { value: 'no_island',  label: 'No island' },
      ],
      showIf: (a) => a.kitchen_lighting === 'update' },

    // Demo + Permit
    { id: 'kitchen_demo', type: 'single', label: 'Demo',
      options: [{ value: 'full', label: 'Full demo' }, { value: 'partial', label: 'Partial demo' }] },

    { id: 'kitchen_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
  ],

  // ─────────────────────────────────────────────────────────────────
  // DECK / PATIO
  // ─────────────────────────────────────────────────────────────────
  deck: [
    { id: 'deck_type', type: 'single', label: 'New deck or replacement?',
      options: [{ value: 'new', label: 'New' }, { value: 'replacement', label: 'Replacement' }] },

    { id: 'deck_existing_structure', type: 'single', label: 'Is existing structure in good shape?',
      options: [
        { value: 'good',    label: 'Yes — only replace decking' },
        { value: 'rebuild', label: 'No — rebuild structure' },
        { value: 'unsure',  label: "Don't know — needs evaluation" },
      ],
      showIf: (a) => a.deck_type === 'replacement' },

    { id: 'deck_dims', type: 'dimensions', label: 'Dimensions', unit: 'ft' },

    { id: 'deck_height', type: 'single', label: 'Deck height from ground',
      options: [
        { value: 'under_30',   label: 'Less than 30"' },
        { value: '30_to_6ft',  label: '30" to 6 ft' },
        { value: 'over_6ft',   label: 'More than 6 ft' },
      ] },

    { id: 'deck_material', type: 'single', label: 'Decking material',
      options: [
        { value: 'pt_wood',   label: 'Pressure Treated Wood' },
        { value: 'cedar',     label: 'Cedar' },
        { value: 'composite', label: 'Composite (Trex / TimberTech)' },
        { value: 'pvc',       label: 'PVC (Azek)' },
      ] },

    { id: 'deck_attachment', type: 'single', label: 'Attached or freestanding?',
      options: [
        { value: 'attached',     label: 'Attached' },
        { value: 'freestanding', label: 'Freestanding' },
      ] },

    { id: 'deck_siding', type: 'single', label: 'Exterior siding of the house',
      options: [
        { value: 'vinyl',  label: 'Vinyl siding' },
        { value: 'wood',   label: 'Wood siding' },
        { value: 'stucco', label: 'Stucco' },
        { value: 'brick',  label: 'Brick' },
        { value: 'stone',  label: 'Stone' },
      ],
      showIf: (a) => a.deck_attachment === 'attached' },

    { id: 'deck_terrain', type: 'single', label: 'Terrain',
      options: [
        { value: 'flat',         label: 'Flat' },
        { value: 'slight_slope', label: 'Slight slope' },
        { value: 'steep_slope',  label: 'Steep slope' },
        { value: 'rock',         label: 'Rocky' },
      ] },

    { id: 'deck_guardrail', type: 'single', label: 'Guardrail (required above 30" in CT)',
      helper: 'Required by code if deck height > 30"',
      options: [
        { value: 'not_needed', label: 'Not needed' },
        { value: 'needed',     label: 'Yes — needed' },
      ] },

    { id: 'deck_guardrail_material', type: 'single', label: 'Guardrail material',
      options: [
        { value: 'pt_wood',  label: 'Pressure Treated Wood' },
        { value: 'aluminum', label: 'Aluminum' },
        { value: 'cable',    label: 'Cable rail' },
        { value: 'glass',    label: 'Glass' },
      ],
      showIf: (a) => a.deck_guardrail === 'needed' },

    { id: 'deck_stairs', type: 'single', label: 'Stairs',
      options: [
        { value: 'none', label: 'Not needed' },
        { value: 'yes',  label: 'Yes' },
      ] },

    { id: 'deck_stair_flights', type: 'single', label: 'How many flights?',
      options: [
        { value: '1',   label: '1' },
        { value: '2',   label: '2' },
        { value: '3+',  label: '3 or more' },
      ],
      showIf: (a) => a.deck_stairs === 'yes' },

    { id: 'deck_landing', type: 'single', label: 'Landing needed?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.deck_stairs === 'yes' },

    { id: 'deck_extras', type: 'multi', label: 'Extras',
      helper: 'Select all that apply',
      options: [
        { value: 'pergola',     label: 'Pergola / cover' },
        { value: 'bench',       label: 'Built-in bench' },
        { value: 'planter',     label: 'Built-in planter' },
        { value: 'lighting',    label: 'Built-in lighting' },
        { value: 'gas_firepit', label: 'Gas line / Firepit' },
        { value: 'hot_tub',     label: 'Hot tub pad' },
        { value: 'none',        label: 'None',              exclusive: true },
      ] },

    { id: 'deck_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
  ],
};

// ─── Fallback for services without a detailed schema ─────────────────
function fallbackSchema(serviceId) {
  return [
    { id: `${serviceId}_description`, type: 'text',
      label: 'Describe the project scope',
      placeholder: 'Dimensions, materials, goals, any known constraints...' },
    { id: `${serviceId}_permit`, type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
  ];
}

// Build a flat list of questions for a job's comma-separated service string.
// Each question is tagged with `_service` so the UI can show which service
// it belongs to when multiple services are selected.
export function getSchemaForServices(serviceString) {
  const ids = String(serviceString || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const id of ids) {
    const schema = QUESTIONNAIRE_SCHEMAS[id] || fallbackSchema(id);
    out.push(...schema.map((q) => ({ ...q, _service: id })));
  }
  return out;
}

// Evaluate visibility. Accepts a function or a tiny {id, values} spec for
// backwards compatibility.
export function isVisible(question, answers) {
  if (!question.showIf) return true;
  try {
    if (typeof question.showIf === 'function') return !!question.showIf(answers);
    if (typeof question.showIf === 'object' && question.showIf.id) {
      const v = answers[question.showIf.id];
      return Array.isArray(question.showIf.values)
        ? question.showIf.values.includes(v)
        : v === question.showIf.value;
    }
  } catch { /* swallow */ }
  return true;
}

// Utility — human label for a service id
export function serviceLabel(id) {
  return SERVICES.find((s) => s.id === id)?.label || id;
}

// ─── Legacy compatibility shims ──────────────────────────────────────
// The old review/flow used these helpers. The new questionnaire does not
// render the review screen (it skips straight to Report), but the unused
// ReviewAnswers.jsx still imports them. Returning safe empty values keeps
// the build green without dragging the old multi-section engine along.
export function getSectionsForServices(/* serviceString */) {
  return [];
}
export function shouldShowQuestion(/* question, answers */) {
  return false;
}
export function countAnswered(/* answers, sections */) {
  return { answered: 0, total: 0 };
}
// Some old code references GENERAL_SECTIONS directly.
export const GENERAL_SECTIONS = [];
