// ════════════════════════════════════════════════════════════════════
// OMEGA — Smart conditional questionnaire
// Each service defines an ORDERED list of questions. Questions with a
// `showIf(answers)` predicate appear/disappear dynamically based on
// earlier answers. The UI presents ONE visible question at a time.
// ════════════════════════════════════════════════════════════════════

import {
  brandOptions,
  seriesOptionsFor,
  lineOptionsFor,
  colorOptionsFor,
  needsLineQuestion,
} from './cabinetCatalog';

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
    { _section: 'general', label: 'General Information' },
    { id: 'bath_dims', type: 'dimensions', label: 'What are the bathroom dimensions?', unit: 'ft' },

    { _section: 'bathtub', label: 'Bathtub' },
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
    { _section: 'shower', label: 'Shower' },
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
    { _section: 'vanity', label: 'Vanity' },
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
    { _section: 'toilet', label: 'Toilet' },
    { id: 'bath_toilet', type: 'single', label: 'Toilet',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }] },

    // Floor
    { _section: 'floor', label: 'Floor' },
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
    { _section: 'lighting', label: 'Lighting' },
    { id: 'bath_lighting', type: 'single', label: 'Lighting',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'update', label: 'Update' }] },

    { id: 'bath_recessed', type: 'single', label: 'Recessed lights?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.bath_lighting === 'update' },

    { id: 'bath_vanity_light', type: 'single', label: 'Vanity light?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.bath_lighting === 'update' },

    // Window
    { _section: 'window', label: 'Window' },
    { id: 'bath_has_window', type: 'single', label: 'Is there a window?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },

    { id: 'bath_window_action', type: 'single', label: 'Keep or replace the window?',
      options: [{ value: 'keep', label: 'Keep' }, { value: 'replace', label: 'Replace' }],
      showIf: (a) => a.bath_has_window === 'yes' },

    // Demo
    { _section: 'demo', label: 'Demolition' },
    { id: 'bath_demo', type: 'single', label: 'Demo scope',
      options: [{ value: 'full', label: 'Full demo' }, { value: 'partial', label: 'Partial demo' }] },

    { id: 'bath_demo_details', type: 'text', label: 'Specify which areas to demo',
      placeholder: 'e.g. tile only, fixtures, remove ceiling, etc.',
      showIf: (a) => a.bath_demo === 'partial' },

    // Permit
    { _section: 'permit', label: 'Permit' },
    { id: 'bath_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
  ],

  // ─────────────────────────────────────────────────────────────────
  // KITCHEN
  // Follows the detailed scope-spec the owner provided: General → Cabinetry
  // → Relocations → Fixtures → Finishes → Appliances → Lighting → Client
  // Purchasing → Permits → Additional Requests. IDs are stable keys; every
  // "location / describe" field is gated by a prior Y/N so the report stays
  // clean when the feature isn't in scope.
  // ─────────────────────────────────────────────────────────────────
  kitchen: [
    // Section markers (`_section`) group subsequent questions into one
    // scrollable page. The UI renders every visible question inside a
    // section together; conditional follow-ups appear inline below the
    // question that triggers them.

    { _section: 'general', label: 'General Information' },
    { id: 'kitchen_dims', type: 'dimensions', label: 'Kitchen dimensions (L x W)', unit: 'ft' },
    { id: 'kitchen_ceiling_height', type: 'number', label: 'Ceiling height (ft)', placeholder: 'e.g. 8' },

    { id: 'kitchen_demo', type: 'single', label: 'Demolition',
      options: [
        { value: 'none',    label: 'No demolition' },
        { value: 'partial', label: 'Partial demolition' },
        { value: 'full',    label: 'Full demolition' },
      ] },
    // Auto-open an observation box as soon as partial or full is picked —
    // the seller almost always has context to capture there.
    { id: 'kitchen_demo_notes', type: 'text', label: 'Demolition notes', optional: true,
      placeholder: 'What exactly is being demolished (walls, cabinets, floor, etc.)',
      showIf: (a) => a.kitchen_demo === 'partial' || a.kitchen_demo === 'full' },

    { id: 'kitchen_layout', type: 'single', label: 'Layout changes',
      options: [
        { value: 'keep',   label: 'Same layout' },
        { value: 'change', label: 'Change layout' },
      ] },
    { id: 'kitchen_layout_desc', type: 'text', label: 'Describe the layout change',
      placeholder: 'What walls move, where does the island go, etc.',
      showIf: (a) => a.kitchen_layout === 'change' },

    { _section: 'cabinetry', label: 'Cabinetry' },
    // Cascade: Brand → Series/Collection → Line (Fabuwood only) → Color.
    // Options are resolved dynamically from cabinetCatalog.js. Picking a
    // brand unlocks the next step; picking "Custom / Other" jumps to a
    // free-text field so rare brands aren't blocked by the catalog.
    { id: 'kitchen_cabinet_brand', type: 'single', label: 'Cabinet manufacturer',
      options: brandOptions },

    { id: 'kitchen_cabinet_custom_brand', type: 'text', label: 'Custom manufacturer / line',
      placeholder: 'Brand, line and color (e.g. KraftMaid Vantage, Dove White)',
      showIf: (a) => a.kitchen_cabinet_brand === 'custom' },

    { id: 'kitchen_cabinet_series', type: 'single', label: 'Series / Collection',
      options: (a) => seriesOptionsFor(a.kitchen_cabinet_brand),
      showIf: (a) => a.kitchen_cabinet_brand === 'fgm' || a.kitchen_cabinet_brand === 'fabuwood' },

    { id: 'kitchen_cabinet_line', type: 'single', label: 'Line',
      options: (a) => lineOptionsFor(a.kitchen_cabinet_brand, a.kitchen_cabinet_series),
      showIf: (a) => needsLineQuestion(a) },

    { id: 'kitchen_cabinet_color', type: 'select', label: 'Cabinet color / finish',
      placeholder: 'Pick a color',
      options: (a) => colorOptionsFor(a.kitchen_cabinet_brand, a.kitchen_cabinet_series, a.kitchen_cabinet_line),
      // Show only once we have enough context:
      //   - FGM needs brand + series
      //   - Fabuwood needs brand + series + line
      showIf: (a) => {
        if (a.kitchen_cabinet_brand === 'fgm')      return !!a.kitchen_cabinet_series;
        if (a.kitchen_cabinet_brand === 'fabuwood') return !!a.kitchen_cabinet_series && !!a.kitchen_cabinet_line;
        return false;
      } },

    { id: 'kitchen_wall_cabinet_height', type: 'select', label: 'Wall cabinet height',
      placeholder: 'Pick a height',
      options: [
        { value: '30', label: '30"' },
        { value: '36', label: '36"' },
        { value: '42', label: '42"' },
        { value: '48', label: '48"' },
        { value: 'custom', label: 'Custom' },
      ] },
    { id: 'kitchen_wall_cabinet_height_custom', type: 'text', label: 'Custom wall cabinet height',
      placeholder: 'e.g. 39"',
      showIf: (a) => a.kitchen_wall_cabinet_height === 'custom' },

    { id: 'kitchen_cabinet_total_height', type: 'text', label: 'Total installed height (floor → top of cabinet)',
      placeholder: 'e.g. 96" to top of crown' },

    { id: 'kitchen_soffit', type: 'single', label: 'Soffit',
      options: [
        { value: 'keep',   label: 'Keep existing soffit' },
        { value: 'build',  label: 'Build new soffit' },
        { value: 'none',   label: 'No soffit' },
      ] },

    { id: 'kitchen_cabinet_custom', type: 'text', label: 'Custom features / dimensions (optional)', optional: true,
      placeholder: 'Soft-close, pull-outs, specific heights, extended uppers, etc.' },

    { _section: 'relocations', label: 'Relocations & Installations' },
    // Shape: every item is gated by a Y/N. Only if "Yes" we open:
    //   1) an "action" question (new install / replace existing / relocate)
    //   2) a location text
    //   3) an optional notes text (seller can explain anything unusual)
    // The block opens with the Appliances flow — if the client is changing
    // any appliances, dropdowns collect the new sizes quickly.

    // New appliances first
    { id: 'kitchen_appliances_change', type: 'single', label: 'Changing any appliances?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },

    // Every appliance dropdown: 1st option = Keep existing,
    // last option = Custom → opens a text field for manual size.

    { id: 'kitchen_new_fridge', type: 'select', label: 'Refrigerator',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',    label: 'Keep existing refrigerator' },
        { value: '24',      label: '24" (counter depth / small)' },
        { value: '30',      label: '30"' },
        { value: '33',      label: '33"' },
        { value: '36',      label: '36"' },
        { value: '42',      label: '42"' },
        { value: '48',      label: '48"' },
        { value: 'builtin', label: 'Built-in / panel-ready' },
        { value: 'custom',  label: 'Custom (enter size)' },
      ],
      showIf: (a) => a.kitchen_appliances_change === 'yes' },
    { id: 'kitchen_new_fridge_custom', type: 'text', label: 'Refrigerator custom size',
      placeholder: 'e.g. 38" wide, panel-ready',
      showIf: (a) => a.kitchen_new_fridge === 'custom' },

    { id: 'kitchen_new_range', type: 'select', label: 'Range / stove',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',   label: 'Keep existing range' },
        { value: '24',     label: '24"' },
        { value: '30',     label: '30"' },
        { value: '36',     label: '36"' },
        { value: '48',     label: '48"' },
        { value: 'custom', label: 'Custom (enter size)' },
      ],
      showIf: (a) => a.kitchen_appliances_change === 'yes' },
    { id: 'kitchen_new_range_custom', type: 'text', label: 'Range custom size',
      placeholder: 'e.g. 60" pro-style',
      showIf: (a) => a.kitchen_new_range === 'custom' },

    { id: 'kitchen_new_hood', type: 'select', label: 'Hood',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',            label: 'Keep existing hood' },
        { value: 'under_30',        label: 'Under-cabinet 30"' },
        { value: 'under_36',        label: 'Under-cabinet 36"' },
        { value: 'wall_30',         label: 'Wall-mount 30"' },
        { value: 'wall_36',         label: 'Wall-mount 36"' },
        { value: 'wall_48',         label: 'Wall-mount 48"' },
        { value: 'island_36',       label: 'Island 36"' },
        { value: 'island_48',       label: 'Island 48"' },
        { value: 'insert',          label: 'Custom insert / liner' },
        { value: 'microwave_combo', label: 'Microwave combo (OTR)' },
        { value: 'custom',          label: 'Custom (enter spec)' },
      ],
      showIf: (a) => a.kitchen_appliances_change === 'yes' },
    { id: 'kitchen_new_hood_custom', type: 'text', label: 'Hood custom spec',
      placeholder: 'e.g. 48" chimney, 1000 CFM',
      showIf: (a) => a.kitchen_new_hood === 'custom' },

    { id: 'kitchen_new_microwave', type: 'select', label: 'Microwave',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',       label: 'Keep existing microwave' },
        { value: 'none',       label: 'No microwave' },
        { value: 'otr',        label: 'Over-the-range (OTR)' },
        { value: 'builtin',    label: 'Built-in (trim kit)' },
        { value: 'drawer',     label: 'Drawer microwave' },
        { value: 'countertop', label: 'Countertop' },
        { value: 'custom',     label: 'Custom (enter spec)' },
      ],
      showIf: (a) => a.kitchen_appliances_change === 'yes' },
    { id: 'kitchen_new_microwave_custom', type: 'text', label: 'Microwave custom spec',
      placeholder: 'Model, size, etc.',
      showIf: (a) => a.kitchen_new_microwave === 'custom' },

    { id: 'kitchen_new_oven', type: 'select', label: 'Wall oven',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',        label: 'Keep existing oven' },
        { value: 'none',        label: 'No separate wall oven' },
        { value: 'single_24',   label: 'Single 24"' },
        { value: 'single_27',   label: 'Single 27"' },
        { value: 'single_30',   label: 'Single 30"' },
        { value: 'double_27',   label: 'Double 27"' },
        { value: 'double_30',   label: 'Double 30"' },
        { value: 'combo_steam', label: 'Combo / steam oven' },
        { value: 'custom',      label: 'Custom (enter spec)' },
      ],
      showIf: (a) => a.kitchen_appliances_change === 'yes' },
    { id: 'kitchen_new_oven_custom', type: 'text', label: 'Oven custom spec',
      placeholder: 'e.g. 36" double wall oven',
      showIf: (a) => a.kitchen_new_oven === 'custom' },

    // Sink lives in the Appliances block — the seller picks the model,
    // the size, and can add notes. Gated by "Changing appliances?" so
    // the block only expands when something is actually being swapped.
    { id: 'kitchen_new_sink_model', type: 'select', label: 'Sink model',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',       label: 'Keep existing sink' },
        { value: 'top_mount',  label: 'Top-mount (drop-in)' },
        { value: 'under_mount',label: 'Under-mount' },
        { value: 'farmhouse',  label: 'Farmhouse / apron-front (farm sink)' },
        { value: 'workstation',label: 'Integrated / workstation' },
        { value: 'bar',        label: 'Bar / prep sink (secondary)' },
        { value: 'custom',     label: 'Custom (enter spec)' },
      ],
      showIf: (a) => a.kitchen_appliances_change === 'yes' },
    { id: 'kitchen_new_sink_custom', type: 'text', label: 'Sink custom spec',
      placeholder: 'Material, finish, brand, etc.',
      showIf: (a) => a.kitchen_new_sink_model === 'custom' },
    { id: 'kitchen_new_sink_size', type: 'text', label: 'Sink size',
      placeholder: 'e.g. 30" single bowl, 33" double bowl',
      showIf: (a) => a.kitchen_appliances_change === 'yes' && a.kitchen_new_sink_model && a.kitchen_new_sink_model !== 'keep' },
    { id: 'kitchen_new_sink_notes', type: 'text', label: 'Sink notes (optional)', optional: true,
      placeholder: 'Garbage disposal, instant hot, special faucet, etc.',
      showIf: (a) => a.kitchen_appliances_change === 'yes' && a.kitchen_new_sink_model && a.kitchen_new_sink_model !== 'keep' },

    { id: 'kitchen_appliances_notes', type: 'text', label: 'Appliance notes (optional)', optional: true,
      placeholder: 'Brand, color, panel-ready, delivery timing, etc.',
      showIf: (a) => a.kitchen_appliances_change === 'yes' },

    // Hood work
    { id: 'kitchen_hood_work', type: 'single', label: 'Any hood work?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_hood_action', type: 'single', label: 'Hood — what kind of work?',
      options: [
        { value: 'new',     label: 'New installation (from scratch)' },
        { value: 'replace', label: 'Replace existing hood' },
        { value: 'relocate', label: 'Relocate existing hood' },
      ],
      showIf: (a) => a.kitchen_hood_work === 'yes' },
    { id: 'kitchen_hood_work_loc', type: 'text', label: 'Hood location',
      placeholder: 'Over range / island / wall',
      showIf: (a) => a.kitchen_hood_work === 'yes' },
    { id: 'kitchen_hood_work_notes', type: 'text', label: 'Hood notes (optional)', optional: true,
      placeholder: 'Venting path, ceiling condition, anything unusual',
      showIf: (a) => a.kitchen_hood_work === 'yes' },

    // Gas line work
    { id: 'kitchen_gas_work', type: 'single', label: 'Any gas line work?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_gas_action', type: 'single', label: 'Gas line — what kind of work?',
      options: [
        { value: 'new',      label: 'New gas line (from scratch)' },
        { value: 'replace',  label: 'Replace existing line' },
        { value: 'relocate', label: 'Relocate existing line' },
      ],
      showIf: (a) => a.kitchen_gas_work === 'yes' },
    { id: 'kitchen_gas_work_loc', type: 'text', label: 'Gas line location',
      showIf: (a) => a.kitchen_gas_work === 'yes' },
    { id: 'kitchen_gas_work_notes', type: 'text', label: 'Gas line notes (optional)', optional: true,
      placeholder: 'Distance from main, permit status, etc.',
      showIf: (a) => a.kitchen_gas_work === 'yes' },

    // Sink work
    { id: 'kitchen_sink_work', type: 'single', label: 'Any sink plumbing work?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_sink_action', type: 'single', label: 'Sink — what kind of work?',
      options: [
        { value: 'new',      label: 'New installation (from scratch)' },
        { value: 'replace',  label: 'Replace existing sink' },
        { value: 'relocate', label: 'Relocate existing sink' },
      ],
      showIf: (a) => a.kitchen_sink_work === 'yes' },
    { id: 'kitchen_sink_work_loc', type: 'text', label: 'Sink location',
      placeholder: 'Under window / island / back wall',
      showIf: (a) => a.kitchen_sink_work === 'yes' },
    { id: 'kitchen_sink_work_notes', type: 'text', label: 'Sink notes (optional)', optional: true,
      placeholder: 'Drain line move, garbage disposal, etc.',
      showIf: (a) => a.kitchen_sink_work === 'yes' },

    // Window work
    { id: 'kitchen_window_work', type: 'single', label: 'Any window work?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_window_action', type: 'single', label: 'Window — what kind of work?',
      options: [
        { value: 'new',      label: 'New window (from scratch)' },
        { value: 'replace',  label: 'Replace existing window' },
        { value: 'relocate', label: 'Relocate / resize existing window' },
      ],
      showIf: (a) => a.kitchen_window_work === 'yes' },
    { id: 'kitchen_window_work_loc', type: 'text', label: 'Window location',
      showIf: (a) => a.kitchen_window_work === 'yes' },
    { id: 'kitchen_window_work_notes', type: 'text', label: 'Window notes (optional)', optional: true,
      placeholder: 'Rough opening size, header condition, trim match, etc.',
      showIf: (a) => a.kitchen_window_work === 'yes' },

    // Electrical
    { id: 'kitchen_electrical_changes', type: 'single', label: 'Electrical / wiring changes?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_electrical_changes_desc', type: 'text', label: 'Electrical / wiring scope',
      placeholder: 'New circuits, panel upgrade, dedicated lines…',
      showIf: (a) => a.kitchen_electrical_changes === 'yes' },

    // (Standalone Sink section removed — sink model/size/notes now live
    // in the Appliances section so everything about a new sink is
    // captured in one place.)

    { _section: 'window', label: 'Window' },
    { id: 'kitchen_window_type', type: 'text', label: 'Window type & size',
      placeholder: 'e.g. Double-hung, 36" x 48"' },
    { id: 'kitchen_window_loc', type: 'text', label: 'Window location' },

    { _section: 'island', label: 'Island' },
    { id: 'kitchen_island', type: 'single', label: 'Island',
      options: [
        { value: 'none',   label: "Don't have and don't want" },
        { value: 'keep',   label: 'Have and keep' },
        { value: 'remove', label: 'Have and remove' },
        { value: 'add',    label: 'Add new' },
      ] },
    { id: 'kitchen_island_dims', type: 'text', label: 'Island dimensions',
      placeholder: 'e.g. 8 ft x 4 ft',
      showIf: (a) => a.kitchen_island === 'add' || a.kitchen_island === 'keep' },
    { id: 'kitchen_island_loc', type: 'text', label: 'Island location',
      showIf: (a) => a.kitchen_island === 'add' || a.kitchen_island === 'keep' },

    { _section: 'pot_filler', label: 'Pot Filler' },
    { id: 'kitchen_pot_filler', type: 'single', label: 'Pot filler?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_pot_filler_loc', type: 'text', label: 'Pot filler location',
      showIf: (a) => a.kitchen_pot_filler === 'yes' },

    { _section: 'finishes', label: 'Finishes & Materials' },
    // Countertops
    { id: 'kitchen_countertop_material', type: 'text', label: 'Countertop material',
      placeholder: 'Quartz / granite / marble / butcher block…' },
    { id: 'kitchen_countertop_layout', type: 'text', label: 'Countertop size / layout',
      placeholder: 'Linear ft, seam locations, waterfall edges…' },

    // Backsplash
    { id: 'kitchen_backsplash_material', type: 'text', label: 'Backsplash material',
      placeholder: 'Subway tile, natural stone, slab, etc.' },
    { id: 'kitchen_backsplash_area', type: 'number', label: 'Backsplash area (sqft)',
      placeholder: 'e.g. 30' },
    { id: 'kitchen_backsplash_height', type: 'single', label: 'Backsplash height',
      options: [
        { value: 'full',   label: 'Full height (counter to ceiling / uppers)' },
        { value: 'normal', label: 'Standard 18"' },
        { value: 'custom', label: 'Custom (specify)' },
      ] },
    { id: 'kitchen_backsplash_height_custom', type: 'text', label: 'Custom backsplash height',
      placeholder: 'e.g. 24" behind range only',
      showIf: (a) => a.kitchen_backsplash_height === 'custom' },

    // Flooring — replacement Y/N gate, only ask details when replacing
    { id: 'kitchen_floor_replace', type: 'single', label: 'Flooring replacement?',
      options: [
        { value: 'yes', label: 'Yes — replace' },
        { value: 'no',  label: 'No — keep existing' },
      ] },
    { id: 'kitchen_floor_type', type: 'single', label: 'Flooring type',
      options: [
        { value: 'hardwood', label: 'Hardwood' },
        { value: 'tile',     label: 'Tile' },
        { value: 'vinyl',    label: 'Vinyl' },
      ],
      showIf: (a) => a.kitchen_floor_replace === 'yes' },
    { id: 'kitchen_floor_area', type: 'number', label: 'Flooring area (sqft)',
      placeholder: 'e.g. 200',
      showIf: (a) => a.kitchen_floor_replace === 'yes' },

    // Trim Work — seller picks which types apply; no quantity (they
    // rarely know linear feet during a walkthrough).
    { id: 'kitchen_trim', type: 'multi', label: 'Trim work',
      helper: 'Select all that apply',
      options: [
        { value: 'crown',    label: 'Crown molding' },
        { value: 'baseboard', label: 'Baseboard' },
        { value: 'casings',  label: 'Casings' },
      ] },

    // Painting
    { id: 'kitchen_paint_scope', type: 'text', label: 'Painting scope / areas',
      placeholder: 'Walls, ceiling, trim, cabinets…' },

    { _section: 'lighting', label: 'Lighting & Electrical' },
    { id: 'kitchen_under_cabinet', type: 'single', label: 'Under-cabinet lights?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_recessed_info', type: 'text', label: 'Recessed lighting — quantity & location',
      placeholder: 'e.g. 6 × 4" LED, evenly spaced over prep area' },
    { id: 'kitchen_outlets_info', type: 'text', label: 'Outlets / switches — quantity & location',
      placeholder: 'New outlets on island, GFCI count, dimmers…' },

    { _section: 'client_supplied', label: 'Client-Supplied Items' },
    // Client-Supplied Items (NOT provided by Omega)
    // This is NOT a question about whether the client wants to buy —
    // Omega does not supply these items at all, so the client is
    // responsible for purchasing each one that applies to this job.
    // Vendor ticks the items relevant to this specific kitchen so the
    // client has a clear shopping list on the report.
    { id: 'kitchen_client_buys', type: 'multi',
      label: 'Client-supplied items (not provided by Omega)',
      helper: 'Omega does NOT provide these items. Check every one that applies to this job — the client must purchase them directly.',
      options: [
        { value: 'appliances',           label: 'Appliances' },
        { value: 'faucet',               label: 'Faucet' },
        { value: 'pendants',             label: 'Pendants' },
        { value: 'cabinet_knobs',        label: 'Cabinet knobs' },
        { value: 'tile_nose',            label: 'Tile nose' },
        { value: 'silicone_grout_color', label: 'Silicone matching grout color' },
        { value: 'farmsink',             label: 'Farm sink or any special sink' },
        { value: 'pot_filler',           label: 'Pot filler faucet' },
        { value: 'sconces',              label: 'Sconces' },
        { value: 'tile',                 label: 'Tile' },
        { value: 'tile_grout',           label: 'Tile grout' },
      ] },

    { _section: 'permits', label: 'Permits & Inspections' },
    { id: 'kitchen_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'not_required', label: 'Not required' },
        { value: 'unsure', label: "Don't know" },
      ] },
    { id: 'kitchen_inspections', type: 'single', label: 'Inspections required?',
      options: [
        { value: 'yes',    label: 'Yes — schedule with town' },
        { value: 'no',     label: 'No' },
        { value: 'unsure', label: "Don't know" },
      ] },

    { _section: 'additional', label: 'Additional Requests' },
    { id: 'kitchen_additional', type: 'single', label: 'Any other requests?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_additional_desc', type: 'text', label: 'Describe additional requests',
      showIf: (a) => a.kitchen_additional === 'yes' },

    // Final section — what the client is willing to spend. Used as input
    // for the estimator / cost projection to calibrate material tiers.
    { _section: 'budget', label: 'Customer Budget' },
    { id: 'kitchen_budget_range', type: 'single', label: 'Client budget range',
      helper: 'What is the client comfortable spending on this kitchen?',
      options: [
        { value: 'under_20k',  label: 'Under $20,000' },
        { value: '20k_40k',    label: '$20,000 – $40,000' },
        { value: '40k_60k',    label: '$40,000 – $60,000' },
        { value: '60k_80k',    label: '$60,000 – $80,000' },
        { value: '80k_100k',   label: '$80,000 – $100,000' },
        { value: '100k_150k',  label: '$100,000 – $150,000' },
        { value: 'over_150k',  label: 'Over $150,000' },
        { value: 'flexible',   label: 'Flexible / not disclosed' },
      ] },
    { id: 'kitchen_budget_notes', type: 'text', label: 'Budget notes (optional)', optional: true,
      placeholder: 'Priorities (e.g. splurge on countertops, save on appliances), financing, must-haves vs nice-to-haves…' },
  ],

  // ─────────────────────────────────────────────────────────────────
  // DECK / PATIO
  // ─────────────────────────────────────────────────────────────────
  deck: [
    { _section: 'general', label: 'General Information' },
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

    { _section: 'site', label: 'Site Conditions' },
    { id: 'deck_terrain', type: 'single', label: 'Terrain',
      options: [
        { value: 'flat',         label: 'Flat' },
        { value: 'slight_slope', label: 'Slight slope' },
        { value: 'steep_slope',  label: 'Steep slope' },
        { value: 'rock',         label: 'Rocky' },
      ] },

    { _section: 'guardrail', label: 'Guardrail & Stairs' },
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

    { _section: 'extras', label: 'Extras' },
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

    { _section: 'permit', label: 'Permit' },
    { id: 'deck_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
  ],

  // ─────────────────────────────────────────────────────────────────
  // FLOORING — 15 questions
  // Covers any floor replacement job: hardwood, LVP, tile, laminate,
  // carpet, polished concrete. Conditional questions skip pattern-
  // only and stair-only prompts when they don't apply.
  // ─────────────────────────────────────────────────────────────────
  flooring: [
    { _section: 'general', label: 'General Information' },

    // 1 — which rooms
    { id: 'floor_areas', type: 'multi', label: 'Which rooms are included?',
      options: [
        { value: 'living',   label: 'Living Room' },
        { value: 'dining',   label: 'Dining Room' },
        { value: 'kitchen',  label: 'Kitchen' },
        { value: 'hallway',  label: 'Hallway' },
        { value: 'bedroom',  label: 'Bedroom(s)' },
        { value: 'bathroom', label: 'Bathroom(s)' },
        { value: 'basement', label: 'Basement' },
        { value: 'whole',    label: 'Whole house', exclusive: true },
      ] },

    // 2 — total square footage
    { id: 'floor_total_sqft', type: 'number', label: 'Total area to be covered', unit: 'sq ft' },

    { _section: 'existing', label: 'Existing Floor' },

    // 3 — current flooring
    { id: 'floor_existing_type', type: 'single', label: 'What is the existing floor?',
      options: [
        { value: 'hardwood',  label: 'Hardwood' },
        { value: 'engineered',label: 'Engineered wood' },
        { value: 'lvp',       label: 'LVP / Vinyl' },
        { value: 'laminate',  label: 'Laminate' },
        { value: 'tile',      label: 'Tile' },
        { value: 'carpet',    label: 'Carpet' },
        { value: 'concrete',  label: 'Concrete / subfloor only' },
        { value: 'other',     label: 'Other' },
      ] },

    // 4 — remove existing?
    { id: 'floor_existing_remove', type: 'single', label: 'Remove the existing floor?',
      options: [
        { value: 'yes', label: 'Yes — remove and haul away' },
        { value: 'no',  label: 'No — install over existing' },
      ] },

    // 5 — subfloor condition
    { id: 'floor_subfloor', type: 'single', label: 'Subfloor condition',
      options: [
        { value: 'good',    label: 'Good — ready to install' },
        { value: 'minor',   label: 'Needs minor patching' },
        { value: 'replace', label: 'Needs partial replacement' },
        { value: 'unknown', label: "Don't know" },
      ] },

    { _section: 'material', label: 'New Material' },

    // 6 — new material
    { id: 'floor_new_material', type: 'single', label: 'New flooring material',
      options: [
        { value: 'hardwood',  label: 'Solid Hardwood' },
        { value: 'engineered',label: 'Engineered Wood' },
        { value: 'lvp',       label: 'LVP / Vinyl Plank' },
        { value: 'laminate',  label: 'Laminate' },
        { value: 'tile',      label: 'Tile / Porcelain' },
        { value: 'carpet',    label: 'Carpet' },
        { value: 'concrete',  label: 'Polished Concrete' },
      ] },

    // 7 — brand / line (text for flexibility)
    { id: 'floor_material_brand', type: 'text',
      label: 'Preferred brand or product line (optional)',
      placeholder: 'e.g. Mohawk RevWood, Shaw Floorte, client to provide' },

    // 8 — color preference
    { id: 'floor_material_color', type: 'text',
      label: 'Color / finish preference',
      placeholder: 'e.g. Natural oak, dark walnut, light grey' },

    // 9 — install pattern (only for plank materials)
    { id: 'floor_pattern', type: 'single', label: 'Install pattern',
      options: [
        { value: 'straight',   label: 'Straight (standard)' },
        { value: 'diagonal',   label: 'Diagonal' },
        { value: 'herringbone',label: 'Herringbone' },
        { value: 'chevron',    label: 'Chevron' },
        { value: 'random',     label: 'Random stagger' },
      ],
      showIf: (a) => ['hardwood', 'engineered', 'lvp', 'laminate'].includes(a.floor_new_material) },

    { _section: 'scope', label: 'Scope' },

    // 10 — baseboards
    { id: 'floor_baseboards', type: 'single', label: 'Baseboards',
      options: [
        { value: 'keep',    label: 'Keep existing' },
        { value: 'replace', label: 'Remove & replace' },
        { value: 'new',     label: 'Install where missing' },
      ] },

    // 11 — transitions between rooms
    { id: 'floor_transitions', type: 'single', label: 'Door / room transitions',
      options: [
        { value: 'match',   label: 'Matching transition strips' },
        { value: 'contrast',label: 'Contrasting strips' },
        { value: 'flush',   label: 'Flush transition (no strip)' },
        { value: 'na',      label: 'Not applicable' },
      ] },

    // 12 — stairs included?
    { id: 'floor_stairs', type: 'single', label: 'Include stairs?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No' },
      ] },

    // 13 — how many stair treads (only if yes)
    { id: 'floor_stair_count', type: 'number', label: 'Number of stair treads',
      showIf: (a) => a.floor_stairs === 'yes' },

    { _section: 'logistics', label: 'Logistics' },

    // 14 — who moves furniture
    { id: 'floor_furniture', type: 'single', label: 'Who moves the furniture?',
      options: [
        { value: 'client', label: 'Client will move it' },
        { value: 'omega',  label: 'Omega handles it' },
        { value: 'empty',  label: 'Rooms will be empty' },
      ] },

    // 15 — timeline
    { id: 'floor_timeline', type: 'single', label: 'Desired timeline',
      options: [
        { value: 'rush',     label: 'ASAP (1-2 weeks)' },
        { value: 'standard', label: 'Within 1 month' },
        { value: 'flexible', label: 'Flexible' },
      ] },
  ],

  // ─────────────────────────────────────────────────────────────────
  // SURVEY — 15 questions
  // Land / property survey: boundary, topographic, ALTA, flood
  // elevation, construction stakeout. Used to scope pricing with
  // the surveyor and to prep the client for site access.
  // ─────────────────────────────────────────────────────────────────
  survey: [
    { _section: 'general', label: 'Survey Type' },

    // 1 — survey purpose/type
    { id: 'survey_type', type: 'single', label: 'Type of survey needed',
      options: [
        { value: 'boundary',   label: 'Boundary / property line' },
        { value: 'topographic',label: 'Topographic' },
        { value: 'alta',       label: 'ALTA / NSPS' },
        { value: 'elevation',  label: 'Flood Elevation Certificate' },
        { value: 'stakeout',   label: 'Construction stakeout' },
        { value: 'mortgage',   label: 'Mortgage / Title' },
      ] },

    // 2 — property type
    { id: 'survey_property_type', type: 'single', label: 'Property type',
      options: [
        { value: 'single',   label: 'Single-family residential' },
        { value: 'multi',    label: 'Multi-family' },
        { value: 'commercial',label: 'Commercial' },
        { value: 'vacant',   label: 'Vacant lot / raw land' },
      ] },

    // 3 — lot size
    { id: 'survey_lot_size', type: 'number', label: 'Approximate lot size', unit: 'sq ft or acres' },

    { _section: 'existing_docs', label: 'Existing Documents' },

    // 4 — existing survey?
    { id: 'survey_existing', type: 'single', label: 'Is there an existing survey for this property?',
      options: [
        { value: 'yes',     label: 'Yes — have a copy' },
        { value: 'yes_lost',label: 'Yes — but cannot locate it' },
        { value: 'no',      label: 'No' },
        { value: 'unsure',  label: "Don't know" },
      ] },

    // 5 — how old (only if exists)
    { id: 'survey_existing_age', type: 'single', label: 'How old is the existing survey?',
      options: [
        { value: 'lt1',   label: 'Less than 1 year' },
        { value: '1to5',  label: '1 – 5 years' },
        { value: '5to15', label: '5 – 15 years' },
        { value: 'gt15',  label: 'Older than 15 years' },
      ],
      showIf: (a) => a.survey_existing === 'yes' },

    // 6 — reason (drives scope)
    { id: 'survey_reason', type: 'single', label: 'Reason for the survey',
      options: [
        { value: 'buying',   label: 'Buying the property' },
        { value: 'selling',  label: 'Selling the property' },
        { value: 'build',    label: 'Planning construction' },
        { value: 'permit',   label: 'Required by permit office' },
        { value: 'dispute',  label: 'Boundary dispute' },
        { value: 'refinance',label: 'Refinance / title' },
        { value: 'other',    label: 'Other' },
      ] },

    // 7 — legal description reference
    { id: 'survey_document_ref', type: 'text',
      label: 'Deed / plat / subdivision name (optional)',
      placeholder: 'e.g. Vol 1234 Pg 56, Lot 7 of Oak Hill Subdivision' },

    { _section: 'site', label: 'Site Conditions' },

    // 8 — boundary markers
    { id: 'survey_boundary_markers', type: 'single', label: 'Are boundary markers / monuments visible on site?',
      options: [
        { value: 'all',   label: 'All / most are visible' },
        { value: 'some',  label: 'Some visible' },
        { value: 'none',  label: 'None visible' },
        { value: 'unsure',label: "Don't know" },
      ] },

    // 9 — encroachments
    { id: 'survey_encroachments', type: 'single', label: 'Any known encroachments (fences, sheds crossing the line)?',
      options: [
        { value: 'yes',    label: 'Yes' },
        { value: 'no',     label: 'No' },
        { value: 'unsure', label: "Don't know" },
      ] },

    // 10 — vegetation density
    { id: 'survey_vegetation', type: 'single', label: 'Vegetation / tree cover',
      options: [
        { value: 'low',      label: 'Low — open lot' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'heavy',    label: 'Heavy — dense trees' },
      ] },

    { _section: 'deliverables', label: 'Deliverables' },

    // 11 — flood zone info needed?
    { id: 'survey_flood_zone', type: 'single', label: 'Need flood zone information?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No' },
      ] },

    // 12 — utility locates needed?
    { id: 'survey_utilities', type: 'single', label: 'Include utility locates?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No' },
      ] },

    // 13 — deliverable format
    { id: 'survey_format', type: 'multi', label: 'Deliverable format',
      options: [
        { value: 'paper',   label: 'Paper (signed & sealed)' },
        { value: 'pdf',     label: 'PDF' },
        { value: 'cad',     label: 'CAD file (.dwg)' },
        { value: 'georef',  label: 'Georeferenced data' },
      ] },

    { _section: 'logistics', label: 'Logistics' },

    // 14 — timeline
    { id: 'survey_timeline', type: 'single', label: 'Timeline',
      options: [
        { value: 'rush',     label: 'Rush (1-2 weeks)' },
        { value: 'standard', label: 'Standard (3-4 weeks)' },
        { value: 'flexible', label: 'Flexible' },
      ] },

    // 15 — access notes
    { id: 'survey_access', type: 'text',
      label: 'Site access notes',
      placeholder: 'Gate codes, locked areas, dogs, contact for access…' },
  ],

  // ─────────────────────────────────────────────────────────────────
  // BUILDING PLANS — 15 questions
  // Architectural / construction drawings for permit submittal and
  // build-out. Captures scope of the drawing set, zoning context, and
  // what engineering stamps are required.
  // ─────────────────────────────────────────────────────────────────
  building_plans: [
    { _section: 'general', label: 'Project Basics' },

    // 1 — project type
    { id: 'plans_project_type', type: 'single', label: 'Project type',
      options: [
        { value: 'new_build',label: 'New construction' },
        { value: 'addition', label: 'Addition to existing structure' },
        { value: 'remodel',  label: 'Interior remodel / reconfigure' },
        { value: 'adu',      label: 'ADU / accessory unit' },
        { value: 'structural',label:'Structural change (wall removal, etc.)' },
        { value: 'garage',   label: 'Garage / accessory building' },
      ] },

    // 2 — square footage
    { id: 'plans_total_sqft', type: 'number', label: 'Total conditioned square footage', unit: 'sq ft' },

    // 3 — number of stories
    { id: 'plans_story_count', type: 'single', label: 'Number of stories',
      options: [
        { value: '1',     label: '1 story' },
        { value: '1.5',   label: '1.5 story' },
        { value: '2',     label: '2 stories' },
        { value: '3plus', label: '3 or more stories' },
      ] },

    { _section: 'existing', label: 'Existing Structure' },

    // 4 — is there existing structure?
    { id: 'plans_existing_structure', type: 'single', label: 'Is there an existing structure?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No — bare lot' },
      ] },

    // 5 — as-built drawings available?
    { id: 'plans_asbuilt', type: 'single', label: 'Do you have as-built drawings of the existing structure?',
      options: [
        { value: 'yes',    label: 'Yes — will provide' },
        { value: 'partial',label: 'Partial / floor plan only' },
        { value: 'no',     label: 'No' },
      ],
      showIf: (a) => a.plans_existing_structure === 'yes' },

    { _section: 'drawing_set', label: 'Drawing Set' },

    // 6 — permit set needed?
    { id: 'plans_permit_set', type: 'single', label: 'Permit drawings needed?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No' },
      ] },

    // 7 — construction set needed?
    { id: 'plans_construction_set', type: 'single', label: 'Construction drawings needed?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No — permit set only' },
      ] },

    // 8 — 3D renderings?
    { id: 'plans_renderings', type: 'single', label: '3D renderings / visualizations?',
      options: [
        { value: 'exterior',label: 'Exterior only' },
        { value: 'interior',label: 'Interior only' },
        { value: 'both',    label: 'Both' },
        { value: 'no',      label: 'Not needed' },
      ] },

    // 9 — structural engineering
    { id: 'plans_structural_eng', type: 'single', label: 'Structural engineering stamp required?',
      options: [
        { value: 'yes',    label: 'Yes' },
        { value: 'no',     label: 'No' },
        { value: 'unsure', label: "Don't know — check with building dept." },
      ] },

    // 10 — energy calcs
    { id: 'plans_energy_calcs', type: 'single', label: 'Energy / ResCheck calculations required?',
      options: [
        { value: 'yes',    label: 'Yes' },
        { value: 'no',     label: 'No' },
        { value: 'unsure', label: "Don't know" },
      ] },

    { _section: 'zoning', label: 'Zoning & Site' },

    // 11 — zoning district
    { id: 'plans_zoning_district', type: 'text',
      label: 'Zoning district (if known)',
      placeholder: 'e.g. R-1, RA-2, OS-40' },

    // 12 — lot dimensions
    { id: 'plans_lot_dims', type: 'dimensions', label: 'Lot dimensions (frontage × depth)', unit: 'ft' },

    // 13 — setbacks known?
    { id: 'plans_setbacks_known', type: 'single', label: 'Are setback requirements known?',
      options: [
        { value: 'yes',    label: 'Yes — client will share' },
        { value: 'research',label:'Need to research at town hall' },
        { value: 'unsure', label: "Don't know" },
      ] },

    { _section: 'stamps', label: 'Stamps & Timeline' },

    // 14 — architect stamp
    { id: 'plans_architect_stamp', type: 'single', label: 'Architect stamp required?',
      options: [
        { value: 'yes',    label: 'Yes — building dept. requires it' },
        { value: 'no',     label: 'No' },
        { value: 'unsure', label: "Don't know" },
      ] },

    // 15 — timeline
    { id: 'plans_timeline', type: 'single', label: 'When do you need the plans?',
      options: [
        { value: 'rush',     label: 'Rush (2-3 weeks)' },
        { value: 'standard', label: 'Standard (4-6 weeks)' },
        { value: 'flexible', label: 'Flexible' },
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

// ─── Section-mode helpers ───────────────────────────────────────────
// A "section marker" is an entry in the schema shaped like
//   { _section: 'general', label: 'General Information' }
// Questions that follow a marker belong to that section until the next
// marker. If a schema has zero markers we stay in legacy "one question
// per page" mode.

export function isSectionMarker(entry) {
  return entry && typeof entry === 'object' && '_section' in entry && !('type' in entry);
}

export function hasSectionMarkers(schema) {
  return Array.isArray(schema) && schema.some(isSectionMarker);
}

/**
 * Group a schema (optionally filtered by current answers) into sections.
 * Only sections with at least one *visible* question are returned.
 *
 * Shape:
 *   [
 *     { id, label, service, questions: [q, q, ...] },
 *     ...
 *   ]
 */
export function splitIntoSections(schema, answers) {
  const sections = [];
  let current = null;
  for (const entry of schema || []) {
    if (isSectionMarker(entry)) {
      current = {
        id: entry._section,
        label: entry.label || entry._section,
        service: entry._service || null,
        questions: [],
      };
      sections.push(current);
      continue;
    }
    // Bare question with no preceding marker → stash under a synthetic
    // section so nothing is dropped.
    if (!current) {
      current = { id: '__untagged__', label: '', service: entry._service || null, questions: [] };
      sections.push(current);
    }
    if (isVisible(entry, answers)) current.questions.push(entry);
  }
  return sections.filter((s) => s.questions.length > 0);
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
