// ════════════════════════════════════════════════════════════════════
// OMEGA — Smart conditional questionnaire
// Each service defines an ORDERED list of questions. Questions with a
// `showIf(answers)` predicate appear/disappear dynamically based on
// earlier answers. The UI renders one SECTION at a time (every visible
// question inside a `_section` marker on the same screen) so the seller
// fills entire blocks at once instead of clicking "next" per field.
// ════════════════════════════════════════════════════════════════════

import {
  brandOptions,
  seriesOptionsFor,
  lineOptionsFor,
  colorOptionsFor,
  needsLineQuestion,
} from './cabinetCatalog';

// Canonical service list lives in shared/ so JobFullView and other
// shared components can use it without reaching into apps/sales/.
// We import it locally AND re-export so:
//   1. existing `import { SERVICES } from '../data/questionnaire'`
//      calls keep working (re-export side);
//   2. `serviceLabel()` below — which lives in this same file — can
//      reference SERVICES as a local binding (a bare `export … from`
//      creates only the re-export, not a local symbol).
import { SERVICES } from '../../../shared/data/services';
export { SERVICES };

// ─── Question type reference ────────────────────────────────────────
// { id, type, label, helper?, options?, unit?, placeholder?, showIf?,
//   optional? }
// - single     : large buttons, one choice — auto-advances on click
// - multi      : large buttons, many choices — needs Continue
// - select     : dropdown with many options
// - dimensions : two number inputs (width x length) with unit
// - number     : single number input
// - text       : text input / textarea
// ─────────────────────────────────────────────────────────────────────

export const QUESTIONNAIRE_SCHEMAS = {
  // ─────────────────────────────────────────────────────────────────
  // BATHROOM — rebuilt 2026-04-27 to mirror the field "ESTIMATE
  // CHECKLIST" PDF. Questions are grouped into 10 blocks by similarity
  // (sizes/demo, shower & tub, toilet, vanity, comfort, plumbing,
  // lighting, tile, client-supplied, permit). Yes/No gates open optional
  // detail fields so the seller never has to fill in details for a
  // feature the client doesn't want.
  // ─────────────────────────────────────────────────────────────────
  bathroom: [
    { _section: 'overview', label: 'Project Overview & Demolition' },
    { id: 'bath_dims', type: 'dimensions', label: 'Bathroom dimensions (L × W)', unit: 'ft' },
    { id: 'bath_ceiling_height', type: 'number', label: 'Ceiling height (ft)', placeholder: 'e.g. 8', optional: true },
    { id: 'bath_demo', type: 'single', label: 'Demolition scope',
      options: [
        { value: 'partial', label: 'Partial (shower / floor / vanity)' },
        { value: 'full',    label: 'Full demolition' },
        { value: 'none',    label: 'No demolition' },
      ] },
    { id: 'bath_demo_details', type: 'text', label: 'Demolition notes', optional: true,
      placeholder: 'Specify which areas to demo',
      showIf: (a) => a.bath_demo === 'partial' || a.bath_demo === 'full' },
    { id: 'bath_layout_change', type: 'single', label: 'Change layout?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_layout_desc', type: 'text', label: 'Describe the layout change',
      showIf: (a) => a.bath_layout_change === 'yes' },

    { _section: 'shower_tub', label: 'Shower & Tub' },
    { id: 'bath_has_tub', type: 'single', label: 'Existing bathtub?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_tub_action', type: 'single', label: 'What to do with the bathtub?',
      options: [
        { value: 'keep',     label: 'Keep' },
        { value: 'refinish', label: 'Refinish' },
        { value: 'remove',   label: 'Remove' },
      ],
      showIf: (a) => a.bath_has_tub === 'yes' },
    { id: 'bath_tub_size', type: 'text', label: 'Bathtub size', optional: true,
      placeholder: 'e.g. 60 × 30 alcove',
      showIf: (a) => a.bath_has_tub === 'yes' && a.bath_tub_action !== 'remove' },
    { id: 'bath_freestanding_tub', type: 'single', label: 'Free-standing tub?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_freestanding_tub_specs', type: 'text', label: 'Free-standing tub size & location',
      placeholder: 'e.g. 60 × 30, center wall',
      showIf: (a) => a.bath_freestanding_tub === 'yes' },
    { id: 'bath_has_shower', type: 'single', label: 'Will there be a shower?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_shower_dims', type: 'dimensions', label: 'Shower size', unit: 'ft',
      showIf: (a) => a.bath_has_shower === 'yes' },
    { id: 'bath_shower_material', type: 'single', label: 'Shower wall material',
      options: [
        { value: 'porcelain',     label: 'Porcelain' },
        { value: 'ceramic',       label: 'Ceramic' },
        { value: 'natural_stone', label: 'Natural stone' },
        { value: 'large_format',  label: 'Large format' },
      ],
      showIf: (a) => a.bath_has_shower === 'yes' },
    { id: 'bath_shower_curb_type', type: 'single', label: 'Curb or curbless?',
      options: [
        { value: 'curb',     label: 'With curb' },
        { value: 'curbless', label: 'Curbless' },
      ],
      showIf: (a) => a.bath_has_shower === 'yes' },
    { id: 'bath_shower_curb_specs', type: 'text', label: 'Curb dimensions & material',
      placeholder: 'e.g. 60" × 6", marble',
      showIf: (a) => a.bath_has_shower === 'yes' && a.bath_shower_curb_type === 'curb' },
    { id: 'bath_drain', type: 'single', label: 'Drain position',
      options: [
        { value: 'center',      label: 'Center' },
        { value: 'linear_wall', label: 'Linear — against wall' },
        { value: 'corner',      label: 'Corner' },
      ],
      showIf: (a) => a.bath_has_shower === 'yes' },
    { id: 'bath_glass', type: 'single', label: 'Glass enclosure',
      options: [
        { value: 'frameless',      label: 'Frameless' },
        { value: 'semi_frameless', label: 'Semi-frameless' },
        { value: 'curtain',        label: 'Curtain' },
        { value: 'none',           label: 'None' },
      ],
      showIf: (a) => a.bath_has_shower === 'yes' },

    { _section: 'toilet', label: 'Toilet & Bidet' },
    { id: 'bath_toilet_action', type: 'single', label: 'Toilet',
      options: [
        { value: 'keep',     label: 'Keep' },
        { value: 'replace',  label: 'Replace' },
        { value: 'relocate', label: 'Relocate (check joist position)' },
      ] },
    { id: 'bath_toilet_specs', type: 'text', label: 'Toilet model & location notes', optional: true,
      placeholder: 'Brand/model and where it goes',
      showIf: (a) => a.bath_toilet_action === 'replace' || a.bath_toilet_action === 'relocate' },
    { id: 'bath_bidet', type: 'single', label: 'Bidet?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_bidet_specs', type: 'text', label: 'Bidet location, model & distance from electric panel',
      showIf: (a) => a.bath_bidet === 'yes' },

    { _section: 'vanity_cabinetry', label: 'Vanity & Cabinetry' },
    { id: 'bath_vanity_action', type: 'single', label: 'Vanity',
      options: [
        { value: 'keep',     label: 'Keep' },
        { value: 'refinish', label: 'Refinish' },
        { value: 'replace',  label: 'Replace' },
      ] },
    { id: 'bath_vanity_type', type: 'single', label: 'Single or double sink?',
      options: [{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }],
      showIf: (a) => a.bath_vanity_action === 'replace' },
    { id: 'bath_vanity_size', type: 'text', label: 'Vanity size & style', optional: true,
      placeholder: 'e.g. 36" floating, 60" freestanding',
      showIf: (a) => a.bath_vanity_action === 'replace' },
    { id: 'bath_electric_vanity', type: 'single', label: 'Electric vanity?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_electric_vanity_specs', type: 'text', label: 'Electric vanity size & specs',
      showIf: (a) => a.bath_electric_vanity === 'yes' },
    { id: 'bath_electric_towel_rack', type: 'single', label: 'Electric towel rack?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_electric_towel_rack_specs', type: 'text', label: 'Towel rack size & specs',
      showIf: (a) => a.bath_electric_towel_rack === 'yes' },
    { id: 'bath_medicine_cabinet', type: 'single', label: 'Medicine cabinet',
      options: [
        { value: 'recessed', label: 'Recessed' },
        { value: 'surface',  label: 'Surface mount' },
        { value: 'electric', label: 'Electric' },
        { value: 'none',     label: 'None' },
      ] },

    { _section: 'comfort', label: 'Comfort & Ventilation' },
    { id: 'bath_exhaust_fan', type: 'single', label: 'Exhaust fan',
      options: [
        { value: 'replace', label: 'Replace existing' },
        { value: 'add',     label: 'Add new (check vent location)' },
        { value: 'keep',    label: 'Keep existing' },
      ] },
    { id: 'bath_exhaust_fan_specs', type: 'text', label: 'Exhaust fan model & location',
      showIf: (a) => a.bath_exhaust_fan === 'replace' || a.bath_exhaust_fan === 'add' },
    { id: 'bath_heated_floor', type: 'single', label: 'Heated floor?',
      options: [
        { value: 'electric', label: 'Yes — Electric' },
        { value: 'hydronic', label: 'Yes — Hydronic' },
        { value: 'no',       label: 'No' },
      ] },
    { id: 'bath_heated_floor_dims', type: 'text', label: 'Heated floor area (sqft)',
      showIf: (a) => a.bath_heated_floor === 'electric' || a.bath_heated_floor === 'hydronic' },
    { id: 'bath_steam_shower', type: 'single', label: 'Steam shower?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_steam_shower_specs', type: 'text', label: 'Steam shower location, room size & model',
      showIf: (a) => a.bath_steam_shower === 'yes' },

    { _section: 'plumbing', label: 'Plumbing & Fixtures' },
    { id: 'bath_plumbing_reconfig', type: 'single', label: 'Plumbing reconfiguration?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_plumbing_reconfig_desc', type: 'text', label: 'Describe plumbing changes',
      showIf: (a) => a.bath_plumbing_reconfig === 'yes' },
    { id: 'bath_shower_valve', type: 'single', label: 'Shower valve replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_shower_valve_specs', type: 'text', label: 'Shower valve model, jets & location',
      showIf: (a) => a.bath_shower_valve === 'yes' },
    { id: 'bath_shower_head', type: 'text', label: 'Shower head — describe location', optional: true },
    { id: 'bath_rain_shower', type: 'single', label: 'Rain shower?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_rain_shower_specs', type: 'text', label: 'Rain shower location & quantity',
      showIf: (a) => a.bath_rain_shower === 'yes' },
    { id: 'bath_handheld', type: 'single', label: 'Hand held shower?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_handheld_specs', type: 'text', label: 'Hand held location & quantity',
      showIf: (a) => a.bath_handheld === 'yes' },
    { id: 'bath_water_valve', type: 'single', label: 'Water valve replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_water_valve_model', type: 'text', label: 'Water valve model',
      showIf: (a) => a.bath_water_valve === 'yes' },

    { _section: 'lighting', label: 'Lighting & Electrical' },
    { id: 'bath_shower_led', type: 'single', label: 'Shower LED light (in niche)?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_led_mirror', type: 'single', label: 'LED (electric) mirror?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_led_mirror_specs', type: 'text', label: 'Mirror size & model',
      showIf: (a) => a.bath_led_mirror === 'yes' },
    { id: 'bath_sconces', type: 'single', label: 'Sconces?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_sconces_specs', type: 'text', label: 'Sconces location & quantity',
      showIf: (a) => a.bath_sconces === 'yes' },
    { id: 'bath_lighting_replace', type: 'single', label: 'General lighting replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_lighting_specs', type: 'text', label: 'Lighting size & model',
      showIf: (a) => a.bath_lighting_replace === 'yes' },
    { id: 'bath_additional_lights', type: 'single', label: 'Any additional light fixtures?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_outlets_switches', type: 'single', label: 'Update outlets / switches?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_outlets_model', type: 'text', label: 'Outlets / switches model',
      showIf: (a) => a.bath_outlets_switches === 'yes' },
    { id: 'bath_baseboard_heater', type: 'single', label: 'Baseboard heater cover?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_baseboard_heater_specs', type: 'text', label: 'Baseboard heater size & model',
      showIf: (a) => a.bath_baseboard_heater === 'yes' },
    { id: 'bath_panel_capacity', type: 'single', label: 'Panel capacity',
      options: [
        { value: '100',    label: '100 Amp' },
        { value: '200',    label: '200 Amp' },
        { value: 'unsure', label: "Don't know" },
      ] },

    { _section: 'tile_finishes', label: 'Tile, Niche & Bench' },
    { id: 'bath_tile_material', type: 'text', label: 'Tile material',
      placeholder: 'e.g. Porcelain 12 × 24, ceramic subway' },
    { id: 'bath_tile_size_pattern', type: 'text', label: 'Tile size & pattern',
      placeholder: 'e.g. 12 × 24 stacked vertical, herringbone' },
    { id: 'bath_tile_height', type: 'single', label: 'Wall tile height',
      options: [
        { value: '4ft',         label: '4 ft' },
        { value: 'full_height', label: 'Full height' },
        { value: 'ceiling',     label: 'Up to ceiling' },
      ] },
    { id: 'bath_niche', type: 'single', label: 'Niche?',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one',  label: '1 niche' },
        { value: 'two',  label: '2 niches' },
      ] },
    { id: 'bath_niche_specs', type: 'text', label: 'Niche location & size (min 12" tall to fit shampoo bottle)',
      showIf: (a) => a.bath_niche === 'one' || a.bath_niche === 'two' },
    { id: 'bath_bench', type: 'single', label: 'Built-in bench?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'bath_bench_specs', type: 'text', label: 'Bench location & size',
      showIf: (a) => a.bath_bench === 'yes' },

    { _section: 'client_supplied', label: 'Client-Supplied Items' },
    { id: 'bath_client_buys', type: 'multi',
      label: 'Items the client must purchase (Omega does NOT supply)',
      helper: 'Check every one that applies to this job',
      options: [
        { value: 'vanity',             label: 'Vanity' },
        { value: 'faucet',             label: 'Faucet' },
        { value: 'toilet',             label: 'Toilet' },
        { value: 'bathtub',            label: 'Bathtub' },
        { value: 'freestanding_tub',   label: 'Free-standing tub' },
        { value: 'shower_valve',       label: 'Shower valve' },
        { value: 'hand_held',          label: 'Hand held' },
        { value: 'shower_head',        label: 'Shower head' },
        { value: 'rain_shower',        label: 'Rain shower' },
        { value: 'shower_trims',       label: 'Shower trims' },
        { value: 'sconces',            label: 'Sconces' },
        { value: 'pendants',           label: 'Pendants' },
        { value: 'exhaust_fan',        label: 'Exhaust fan' },
        { value: 'tile',               label: 'Tile' },
        { value: 'tile_nose',          label: 'Tile nose' },
        { value: 'grout_silicone',     label: 'Grout & silicone (bought with tile)' },
        { value: 'stone_niche',        label: 'Stone for niche' },
        { value: 'stone_curb',         label: 'Stone for curb' },
        { value: 'water_valve_finish', label: 'Water valve (if black/bronze/brass)' },
        { value: 'custom_finish',      label: 'Any other custom finish' },
      ] },

    { _section: 'permit_extras', label: 'Permit & Extras' },
    { id: 'bath_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
    { id: 'bath_other_request', type: 'text', label: 'Any other request?', optional: true,
      placeholder: 'Anything special the client mentioned' },
  ],

  // ─────────────────────────────────────────────────────────────────
  // KITCHEN — rebuilt 2026-04-27 to mirror the field "ESTIMATE
  // CHECKLIST" PDF. Blocks: overview, cabinetry & countertop,
  // plumbing & gas, appliances, windows & doors, lighting, finishes,
  // client-supplied, permit/budget. Cabinet brand cascade (FGM /
  // Fabuwood) is preserved from the previous schema.
  // ─────────────────────────────────────────────────────────────────
  kitchen: [
    { _section: 'overview', label: 'Project Overview & Demolition' },
    { id: 'kitchen_dims', type: 'dimensions', label: 'Kitchen dimensions (L × W)', unit: 'ft' },
    { id: 'kitchen_ceiling_height', type: 'number', label: 'Ceiling height (ft)', placeholder: 'e.g. 8' },
    { id: 'kitchen_demo', type: 'single', label: 'Demolition',
      options: [
        { value: 'none',    label: 'No demolition' },
        { value: 'partial', label: 'Partial demolition' },
        { value: 'full',    label: 'Full demolition' },
      ] },
    { id: 'kitchen_demo_notes', type: 'text', label: 'Demolition notes', optional: true,
      placeholder: 'What exactly is being demolished',
      showIf: (a) => a.kitchen_demo === 'partial' || a.kitchen_demo === 'full' },
    { id: 'kitchen_layout', type: 'single', label: 'Layout',
      options: [
        { value: 'keep',   label: 'Same layout (get pictures with each cabinet dimension)' },
        { value: 'change', label: 'Change layout' },
      ] },
    { id: 'kitchen_layout_desc', type: 'text', label: 'Describe the layout change',
      showIf: (a) => a.kitchen_layout === 'change' },

    { _section: 'cabinetry', label: 'Cabinets & Countertop' },
    // Brand cascade preserved: brand → series → line (Fabuwood) → color.
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
      showIf: (a) => {
        if (a.kitchen_cabinet_brand === 'fgm')      return !!a.kitchen_cabinet_series;
        if (a.kitchen_cabinet_brand === 'fabuwood') return !!a.kitchen_cabinet_series && !!a.kitchen_cabinet_line;
        return false;
      } },
    { id: 'kitchen_cabinet_dims', type: 'text', label: 'Cabinet dimensions',
      placeholder: 'Linear ft, configuration, custom heights' },
    { id: 'kitchen_countertop_material', type: 'text', label: 'Countertop material',
      placeholder: 'Quartz / granite / marble / butcher block' },
    { id: 'kitchen_countertop_dims', type: 'text', label: 'Countertop dimensions',
      placeholder: 'Linear ft, seam locations, waterfall edges' },
    { id: 'kitchen_insulation', type: 'single', label: 'Insulation needed?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_insulation_dims', type: 'text', label: 'Insulation dimensions',
      showIf: (a) => a.kitchen_insulation === 'yes' },

    { _section: 'plumbing_gas', label: 'Plumbing & Gas' },
    { id: 'kitchen_sink_action', type: 'single', label: 'Sink',
      options: [
        { value: 'keep',     label: 'Keep existing' },
        { value: 'replace',  label: 'Replace' },
        { value: 'relocate', label: 'Relocate (check access below)' },
      ] },
    { id: 'kitchen_sink_specs', type: 'text', label: 'Sink material, size & style',
      placeholder: 'e.g. 30" undermount stainless',
      showIf: (a) => a.kitchen_sink_action === 'replace' || a.kitchen_sink_action === 'relocate' },
    { id: 'kitchen_sink_loc', type: 'text', label: 'Sink location',
      showIf: (a) => a.kitchen_sink_action === 'relocate' },
    { id: 'kitchen_pot_filler', type: 'single', label: 'Pot filler?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_pot_filler_loc', type: 'text', label: 'Pot filler location',
      showIf: (a) => a.kitchen_pot_filler === 'yes' },
    { id: 'kitchen_gas_action', type: 'single', label: 'Gas line',
      options: [
        { value: 'none',     label: 'Not applicable' },
        { value: 'keep',     label: 'Keep existing' },
        { value: 'install',  label: 'New installation (check access below)' },
        { value: 'relocate', label: 'Relocate (check access below)' },
      ] },
    { id: 'kitchen_gas_loc', type: 'text', label: 'Gas line location',
      showIf: (a) => a.kitchen_gas_action === 'install' || a.kitchen_gas_action === 'relocate' },
    { id: 'kitchen_hood_action', type: 'single', label: 'Hood',
      options: [
        { value: 'keep',     label: 'Keep existing' },
        { value: 'install',  label: 'New installation (check outside area)' },
        { value: 'relocate', label: 'Relocate' },
      ] },
    { id: 'kitchen_hood_loc', type: 'text', label: 'Hood location',
      showIf: (a) => a.kitchen_hood_action === 'install' || a.kitchen_hood_action === 'relocate' },
    { id: 'kitchen_instant_hot', type: 'single', label: 'Instant hot water tank?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_instant_hot_specs', type: 'text', label: 'Instant hot water specs & location',
      showIf: (a) => a.kitchen_instant_hot === 'yes' },

    { _section: 'appliances', label: 'Appliances' },
    { id: 'kitchen_microwave', type: 'select', label: 'Microwave',
      placeholder: 'Pick an option',
      options: [
        { value: 'keep',       label: 'Keep existing' },
        { value: 'none',       label: 'No microwave' },
        { value: 'otr',        label: 'Over-the-range (OTR)' },
        { value: 'builtin',    label: 'Built-in (trim kit)' },
        { value: 'drawer',     label: 'Drawer microwave' },
        { value: 'countertop', label: 'Countertop' },
        { value: 'custom',     label: 'Custom' },
      ] },
    { id: 'kitchen_microwave_loc', type: 'text', label: 'Microwave location & spec', optional: true,
      showIf: (a) => a.kitchen_microwave && a.kitchen_microwave !== 'keep' && a.kitchen_microwave !== 'none' },
    { id: 'kitchen_oven', type: 'select', label: 'Oven',
      options: [
        { value: 'keep',           label: 'Keep existing' },
        { value: 'none',           label: 'No separate oven' },
        { value: 'single_gas',     label: 'Single — gas' },
        { value: 'single_electric',label: 'Single — electric' },
        { value: 'double_gas',     label: 'Double — gas' },
        { value: 'double_electric',label: 'Double — electric' },
        { value: 'custom',         label: 'Custom' },
      ] },
    { id: 'kitchen_oven_size', type: 'text', label: 'Oven size & spec',
      showIf: (a) => a.kitchen_oven && !['keep', 'none'].includes(a.kitchen_oven) },
    { id: 'kitchen_stove', type: 'select', label: 'Stove',
      options: [
        { value: 'keep',      label: 'Keep existing' },
        { value: 'none',      label: 'No stove' },
        { value: 'gas',       label: 'Gas' },
        { value: 'electric',  label: 'Electric' },
        { value: 'induction', label: 'Induction' },
      ] },
    { id: 'kitchen_stove_size', type: 'text', label: 'Stove size',
      showIf: (a) => a.kitchen_stove && !['keep', 'none'].includes(a.kitchen_stove) },
    { id: 'kitchen_cooktop', type: 'select', label: 'Cooktop',
      options: [
        { value: 'keep',      label: 'Keep existing' },
        { value: 'none',      label: 'No separate cooktop' },
        { value: 'gas',       label: 'Gas' },
        { value: 'electric',  label: 'Electric' },
        { value: 'induction', label: 'Induction' },
      ] },
    { id: 'kitchen_cooktop_size', type: 'text', label: 'Cooktop size',
      showIf: (a) => a.kitchen_cooktop && !['keep', 'none'].includes(a.kitchen_cooktop) },
    { id: 'kitchen_burner_rangetop', type: 'single', label: 'Burner rangetop?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_burner_rangetop_size', type: 'text', label: 'Burner rangetop size',
      showIf: (a) => a.kitchen_burner_rangetop === 'yes' },
    { id: 'kitchen_steam_oven', type: 'single', label: 'Steam oven?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_steam_oven_specs', type: 'text', label: 'Steam oven gas/electric & size',
      showIf: (a) => a.kitchen_steam_oven === 'yes' },
    { id: 'kitchen_appliances_notes', type: 'text', label: 'Appliance notes', optional: true,
      placeholder: 'Brand, color, panel-ready, delivery timing, etc.' },

    { _section: 'windows_doors', label: 'Windows & Doors' },
    { id: 'kitchen_window_action', type: 'single', label: 'Window',
      options: [
        { value: 'keep',     label: 'Keep existing' },
        { value: 'replace',  label: 'Replace' },
        { value: 'relocate', label: 'Relocate (check outside area & siding type)' },
      ] },
    { id: 'kitchen_window_loc', type: 'text', label: 'Window location & notes',
      showIf: (a) => a.kitchen_window_action === 'replace' || a.kitchen_window_action === 'relocate' },
    { id: 'kitchen_door_action', type: 'single', label: 'Door',
      options: [
        { value: 'keep',     label: 'Keep existing' },
        { value: 'replace',  label: 'Replace' },
        { value: 'relocate', label: 'Relocate (check outside area & siding type)' },
      ] },
    { id: 'kitchen_door_loc', type: 'text', label: 'Door location & notes',
      showIf: (a) => a.kitchen_door_action === 'replace' || a.kitchen_door_action === 'relocate' },

    { _section: 'lighting', label: 'Lighting & Electrical' },
    { id: 'kitchen_recessed_light', type: 'single', label: 'Recessed lights?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_recessed_specs', type: 'text', label: 'Recessed quantity & location',
      placeholder: 'e.g. 6 × 4" LED, evenly spaced over prep area',
      showIf: (a) => a.kitchen_recessed_light === 'yes' },
    { id: 'kitchen_undercabinet_light', type: 'single', label: 'Undercabinet light?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_undercabinet_specs', type: 'text', label: 'Undercabinet linear feet',
      showIf: (a) => a.kitchen_undercabinet_light === 'yes' },
    { id: 'kitchen_sconces', type: 'single', label: 'Sconces?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_sconces_specs', type: 'text', label: 'Sconces quantity & location',
      showIf: (a) => a.kitchen_sconces === 'yes' },
    { id: 'kitchen_pendants', type: 'single', label: 'Pendants?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_pendants_specs', type: 'text', label: 'Pendants quantity & location',
      showIf: (a) => a.kitchen_pendants === 'yes' },
    { id: 'kitchen_outlets_info', type: 'text', label: 'Outlets / switches — quantity & location', optional: true,
      placeholder: 'New outlets on island, GFCI count, dimmers…' },

    { _section: 'finishes', label: 'Floors, Tile & Trim' },
    { id: 'kitchen_backsplash_material', type: 'text', label: 'Backsplash material',
      placeholder: 'Subway tile, natural stone, slab, etc.' },
    { id: 'kitchen_backsplash_pattern', type: 'text', label: 'Backsplash size & pattern' },
    { id: 'kitchen_backsplash_height', type: 'single', label: 'Backsplash height',
      options: [
        { value: 'full',   label: 'Full height (counter to ceiling / uppers)' },
        { value: 'normal', label: 'Standard 18"' },
        { value: 'custom', label: 'Custom' },
      ] },
    { id: 'kitchen_backsplash_height_custom', type: 'text', label: 'Custom backsplash height',
      placeholder: 'e.g. 24" behind range only',
      showIf: (a) => a.kitchen_backsplash_height === 'custom' },
    { id: 'kitchen_floor_type', type: 'single', label: 'Floor material',
      options: [
        { value: 'keep',     label: 'Keep existing' },
        { value: 'hardwood', label: 'Hardwood' },
        { value: 'tile',     label: 'Tile' },
        { value: 'vinyl',    label: 'Vinyl' },
      ] },
    { id: 'kitchen_floor_specs', type: 'text', label: 'Floor material, size, stain color, area',
      placeholder: 'e.g. 5" white oak, natural stain, ~250 sqft',
      showIf: (a) => a.kitchen_floor_type && a.kitchen_floor_type !== 'keep' },
    { id: 'kitchen_trim_work', type: 'single', label: 'Trim work?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_trim_specs', type: 'text', label: 'Crown molding model, size, quantity',
      showIf: (a) => a.kitchen_trim_work === 'yes' },
    { id: 'kitchen_painting', type: 'single', label: 'Painting?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'kitchen_painting_desc', type: 'text', label: 'Painting scope (rooms, finishes)',
      showIf: (a) => a.kitchen_painting === 'yes' },

    { _section: 'client_supplied', label: 'Client-Supplied Items' },
    { id: 'kitchen_client_buys', type: 'multi',
      label: 'Items the client must purchase (Omega does NOT supply)',
      helper: 'Check every one that applies to this job',
      options: [
        { value: 'appliances',           label: 'Appliances' },
        { value: 'farm_sink',            label: 'Farm sink or special sink' },
        { value: 'faucet',               label: 'Faucet' },
        { value: 'pot_filler_faucet',    label: 'Pot filler faucet' },
        { value: 'pendants',             label: 'Pendants' },
        { value: 'sconces',              label: 'Sconces' },
        { value: 'cabinet_knobs',        label: 'Cabinet knobs' },
        { value: 'tile',                 label: 'Tile' },
        { value: 'tile_nose',            label: 'Tile nose' },
        { value: 'tile_grout',           label: 'Tile grout' },
        { value: 'silicone_grout_color', label: 'Silicone matching grout color' },
      ] },

    { _section: 'permit_budget', label: 'Permit, Budget & Extras' },
    { id: 'kitchen_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',         label: 'Already have' },
        { value: 'need',         label: 'Need to get' },
        { value: 'not_required', label: 'Not required' },
        { value: 'unsure',       label: "Don't know" },
      ] },
    { id: 'kitchen_inspections', type: 'single', label: 'Inspections required?',
      options: [
        { value: 'yes',    label: 'Yes — schedule with town' },
        { value: 'no',     label: 'No' },
        { value: 'unsure', label: "Don't know" },
      ] },
    { id: 'kitchen_other_request', type: 'text', label: 'Any other request?', optional: true },
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
      placeholder: 'Priorities, financing, must-haves vs nice-to-haves…' },
  ],

  // ─────────────────────────────────────────────────────────────────
  // ROOFING — added 2026-04-27 from the field "ESTIMATE CHECKLIST" PDF.
  // 6 blocks: overview, material, flashing, vents/pipes, repairs, permit.
  // Yes/No gates open optional spec fields so the seller never types
  // for a feature the client doesn't want.
  // ─────────────────────────────────────────────────────────────────
  roofing: [
    { _section: 'overview', label: 'Project Overview' },
    { id: 'roof_squares', type: 'number', label: 'How many squares?', placeholder: 'e.g. 25' },
    { id: 'roof_layers', type: 'number', label: 'How many existing layers?', placeholder: 'e.g. 1', optional: true },
    { id: 'roof_replacement_type', type: 'single', label: 'Replacement type',
      options: [
        { value: 'full',    label: 'Full replacement' },
        { value: 'partial', label: 'Partial replacement' },
      ] },

    { _section: 'roofing_material', label: 'Roofing Material' },
    { id: 'roof_material', type: 'single', label: 'Roofing material',
      options: [
        { value: 'asphalt',       label: 'Asphalt shingles' },
        { value: 'standing_seam', label: 'Standing seam metal' },
        { value: 'cedar',         label: 'Cedar' },
        { value: 'other',         label: 'Other' },
      ] },
    { id: 'roof_asphalt_specs', type: 'text', label: 'Asphalt shingles brand & color',
      placeholder: 'e.g. GAF Timberline HDZ, Charcoal',
      showIf: (a) => a.roof_material === 'asphalt' },
    { id: 'roof_metal_color', type: 'text', label: 'Metal roofing color',
      showIf: (a) => a.roof_material === 'standing_seam' },
    { id: 'roof_other_material', type: 'text', label: 'Specify other material',
      showIf: (a) => a.roof_material === 'other' },
    { id: 'roof_underlayment', type: 'single', label: 'Underlayment?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },

    { _section: 'flashing', label: 'Flashing' },
    { id: 'roof_step_flashing', type: 'single', label: 'Step flashing?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_step_flashing_specs', type: 'text', label: 'Step flashing type & color',
      showIf: (a) => a.roof_step_flashing === 'yes' },
    { id: 'roof_eave_flashing', type: 'single', label: 'Eave flashing?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_eave_flashing_specs', type: 'text', label: 'Eave flashing type & color',
      showIf: (a) => a.roof_eave_flashing === 'yes' },
    { id: 'roof_drip_edge', type: 'single', label: 'Drip edge?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_drip_edge_specs', type: 'text', label: 'Drip edge type & color',
      showIf: (a) => a.roof_drip_edge === 'yes' },
    { id: 'roof_chimney_flashing', type: 'single', label: 'Chimney flashing?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_chimney_flashing_specs', type: 'text', label: 'Chimney flashing quantity & material',
      showIf: (a) => a.roof_chimney_flashing === 'yes' },

    { _section: 'vents_pipes', label: 'Vents & Pipes' },
    { id: 'roof_boot_pipe', type: 'single', label: 'Boot pipe?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_boot_pipe_specs', type: 'text', label: 'Boot pipe type, size & quantity',
      showIf: (a) => a.roof_boot_pipe === 'yes' },
    { id: 'roof_ridge_vent', type: 'single', label: 'Ridge vent?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_ridge_vent_size', type: 'text', label: 'Ridge vent size',
      showIf: (a) => a.roof_ridge_vent === 'yes' },

    { _section: 'repairs', label: 'Repairs & Replacements' },
    { id: 'roof_plywood_replace', type: 'single', label: 'Plywood replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_plywood_qty', type: 'text', label: 'Plywood quantity',
      showIf: (a) => a.roof_plywood_replace === 'yes' },
    { id: 'roof_gutter_replace', type: 'single', label: 'Gutter replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'roof_gutter_specs', type: 'text', label: 'Gutter linear feet & downspout quantity',
      showIf: (a) => a.roof_gutter_replace === 'yes' },

    { _section: 'permit_extras', label: 'Permit & Extras' },
    { id: 'roof_permit', type: 'single', label: 'Permit',
      options: [
        { value: 'have',   label: 'Already have' },
        { value: 'need',   label: 'Need to get' },
        { value: 'unsure', label: "Don't know" },
      ] },
    { id: 'roof_other_request', type: 'text', label: 'Any other request?', optional: true },
  ],

  // ─────────────────────────────────────────────────────────────────
  // DECK / PATIO — rebuilt 2026-04-27 from the field PDF. 6 blocks:
  // overview, foundation/structure, railings/posts, decking surface,
  // trim/extras, permit. The structural block is heavy on Yes/No gates
  // because most replacement decks only need a handful of those.
  // ─────────────────────────────────────────────────────────────────
  deck: [
    { _section: 'overview', label: 'Project Overview' },
    { id: 'deck_dims', type: 'dimensions', label: 'Deck dimensions (L × W)', unit: 'ft' },
    { id: 'deck_material', type: 'single', label: 'Decking material',
      options: [
        { value: 'pt_wood',   label: 'Pressure Treated Wood' },
        { value: 'cedar',     label: 'Cedar' },
        { value: 'composite', label: 'Composite (Trex / TimberTech)' },
        { value: 'pvc',       label: 'PVC (Azek)' },
      ] },
    { id: 'deck_type', type: 'single', label: 'Project type',
      options: [
        { value: 'new',         label: 'New build' },
        { value: 'replacement', label: 'Replacement' },
        { value: 'extension',   label: 'Extension of existing deck' },
      ] },
    { id: 'deck_extension_desc', type: 'text', label: 'Describe deck extension',
      showIf: (a) => a.deck_type === 'extension' },
    { id: 'deck_building_plans', type: 'single', label: 'Building plans?',
      options: [
        { value: 'have',       label: 'Client has plans' },
        { value: 'need',       label: 'Need to draw plans' },
        { value: 'not_needed', label: 'Not needed' },
      ] },
    { id: 'deck_demolition', type: 'single', label: 'Demolition needed?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_height', type: 'single', label: 'Deck height from ground',
      options: [
        { value: 'under_30',  label: 'Less than 30"' },
        { value: '30_to_6ft', label: '30" to 6 ft' },
        { value: 'over_6ft',  label: 'More than 6 ft' },
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

    { _section: 'structure', label: 'Foundation & Structure' },
    { id: 'deck_footings', type: 'single', label: 'Footings?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_footings_qty', type: 'number', label: 'Footings quantity',
      showIf: (a) => a.deck_footings === 'yes' },
    { id: 'deck_simpson_strong_tie', type: 'single', label: 'Simpson Strong Tie?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_simpson_qty', type: 'number', label: 'Strong Tie quantity (check inside too)',
      showIf: (a) => a.deck_simpson_strong_tie === 'yes' },
    { id: 'deck_floor_replace', type: 'single', label: 'Floor replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_floor_specs', type: 'text', label: 'Floor square feet, quantity, how many stairs',
      showIf: (a) => a.deck_floor_replace === 'yes' },
    { id: 'deck_stringer_replace', type: 'single', label: 'Stringer replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_stringer_specs', type: 'text', label: 'Stringer size & quantity',
      showIf: (a) => a.deck_stringer_replace === 'yes' },
    { id: 'deck_joist_replace', type: 'single', label: 'Joist replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_beam_replace', type: 'single', label: 'Beam replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_rim_board_replace', type: 'single', label: 'Rim board replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_flashing_replace', type: 'single', label: 'Flashing replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_flashing_desc', type: 'text', label: 'Describe flashing',
      showIf: (a) => a.deck_flashing_replace === 'yes' },
    { id: 'deck_post_install', type: 'single', label: 'Post installation?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_post_install_qty', type: 'number', label: 'Posts to install (quantity)',
      showIf: (a) => a.deck_post_install === 'yes' },
    { id: 'deck_post_replace', type: 'single', label: 'Post replacement?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_post_replace_qty', type: 'number', label: 'Posts to replace (quantity)',
      showIf: (a) => a.deck_post_replace === 'yes' },

    { _section: 'railings', label: 'Railings & Posts' },
    { id: 'deck_handrail', type: 'single', label: 'Hand rail?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_handrail_material', type: 'text', label: 'Hand rail material (must be code compliant)',
      showIf: (a) => a.deck_handrail === 'yes' },
    { id: 'deck_railing', type: 'single', label: 'Railing?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_railing_specs', type: 'text', label: 'Railing material, quantity & balluster',
      showIf: (a) => a.deck_railing === 'yes' },
    { id: 'deck_railing_post', type: 'single', label: 'Railing post?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_railing_post_specs', type: 'text', label: 'Railing post material & quantity',
      showIf: (a) => a.deck_railing_post === 'yes' },
    { id: 'deck_post_sleeve', type: 'single', label: 'Post sleeve?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_post_sleeve_specs', type: 'text', label: 'Post sleeve material & quantity',
      showIf: (a) => a.deck_post_sleeve === 'yes' },
    { id: 'deck_post_skirt', type: 'single', label: 'Post skirt?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_post_skirt_specs', type: 'text', label: 'Post skirt material & quantity',
      showIf: (a) => a.deck_post_skirt === 'yes' },

    { _section: 'surface', label: 'Decking Surface' },
    { id: 'deck_board_type', type: 'single', label: 'Deck board type',
      options: [
        { value: 'grooved', label: 'Grooved' },
        { value: 'solid',   label: 'Solid' },
      ] },
    { id: 'deck_board_specs', type: 'text', label: 'Deck board material & quantity',
      placeholder: 'e.g. Trex Transcend 5/4 × 6, ~600 sqft' },
    { id: 'deck_hidden_screws', type: 'single', label: 'Hidden screws?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_hidden_screws_desc', type: 'text', label: 'Hidden screws system',
      showIf: (a) => a.deck_hidden_screws === 'yes' },
    { id: 'deck_picture_frame', type: 'single', label: 'Picture frame?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_picture_frame_specs', type: 'text', label: 'Picture frame material & quantity',
      showIf: (a) => a.deck_picture_frame === 'yes' },

    { _section: 'guardrail_stairs', label: 'Guardrail & Stairs' },
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
        { value: '1',  label: '1' },
        { value: '2',  label: '2' },
        { value: '3+', label: '3 or more' },
      ],
      showIf: (a) => a.deck_stairs === 'yes' },
    { id: 'deck_landing', type: 'single', label: 'Landing needed?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      showIf: (a) => a.deck_stairs === 'yes' },

    { _section: 'extras', label: 'Trim & Extras' },
    { id: 'deck_gate', type: 'single', label: 'Gate?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_gate_specs', type: 'text', label: 'Gate material, quantity & size',
      showIf: (a) => a.deck_gate === 'yes' },
    { id: 'deck_fascia', type: 'single', label: 'Fascia board?',
      options: [
        { value: 'azek',        label: 'Azek' },
        { value: 'primed_pine', label: 'Primed pine' },
        { value: 'no',          label: 'No' },
      ] },
    { id: 'deck_lattice', type: 'single', label: 'Lattice?',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { id: 'deck_lattice_qty', type: 'number', label: 'Lattice quantity',
      showIf: (a) => a.deck_lattice === 'yes' },
    { id: 'deck_extras', type: 'multi', label: 'Other built-in extras',
      helper: 'Select all that apply',
      options: [
        { value: 'pergola',     label: 'Pergola / cover' },
        { value: 'bench',       label: 'Built-in bench' },
        { value: 'planter',     label: 'Built-in planter' },
        { value: 'lighting',    label: 'Built-in lighting' },
        { value: 'gas_firepit', label: 'Gas line / Firepit' },
        { value: 'hot_tub',     label: 'Hot tub pad' },
        { value: 'none',        label: 'None', exclusive: true },
      ] },
    { id: 'deck_special_request', type: 'text', label: 'Any special request?', optional: true },

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
};

// NOTE: `survey` and `building_plans` intentionally have no schema.
// Omega subcontracts both services, so there's nothing for the seller
// to fill in. getSchemaForServices skips them; the Service Selection
// screen shows a "Subcontracted" badge on their cards.
export const NO_QUESTIONNAIRE_SERVICES = new Set(['survey', 'building_plans']);

export function hasQuestionnaire(serviceId) {
  return !NO_QUESTIONNAIRE_SERVICES.has(serviceId);
}

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
    // Subcontracted services (Survey, Building Plans) contribute no
    // questions — we don't even fall through to the generic schema.
    if (NO_QUESTIONNAIRE_SERVICES.has(id)) continue;
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
