// ════════════════════════════════════════════════════════════════════
// OMEGA — Estimate auto-fill from questionnaire answers
// ════════════════════════════════════════════════════════════════════
//
// Maps the seller's answers (jobs.answers JSONB) into a draft estimate:
// a list of { title, items: [{ description, scope, price }] } sections.
// All prices come back as 0 — Attila fills them in based on the job's
// pricing reference. The point is to skip the "type out 30 line items
// from memory" pain entirely.
//
// Each rule is intentionally simple: if a Yes/No answer is yes (or a
// dropdown points at a real selection), push a line item. If the
// follow-up "specs" field has text, that becomes the item's scope.
// Otherwise the scope falls back to a sensible default.
//
// Per Ramon (2026-04-27): no AI, just direct mapping. Seller can add /
// edit / delete every line after the auto-fill runs.

// ─── Helpers ─────────────────────────────────────────────────────────
function pushItem(section, description, scope = '') {
  if (!description) return;
  section.items.push({ description, scope: scope || '', price: 0 });
}

function isYes(v)            { return v === 'yes'; }
function notNoOrEmpty(v)     { return !!v && v !== 'no' && v !== 'none' && v !== 'keep'; }
function dimensionsToText(d) {
  if (!d || typeof d !== 'object') return '';
  const w = (d.width || '').toString().trim();
  const l = (d.length || '').toString().trim();
  if (!w && !l) return '';
  return `${w || '?'} × ${l || '?'}${d.unit ? ` ${d.unit}` : ''}`;
}

function emptySection(title) {
  return { title, items: [] };
}

// ─── BATHROOM ────────────────────────────────────────────────────────
// 10 sections matching the questionnaire blocks. Empty sections are
// dropped at the end so the seller never sees a blank "Plumbing" row
// because the client kept everything as-is.
function bathroomSections(a) {
  const demoS    = emptySection('Demolition & Site Prep');
  const tubS     = emptySection('Tub & Shower');
  const toiletS  = emptySection('Toilet & Bidet');
  const vanityS  = emptySection('Vanity & Cabinetry');
  const comfortS = emptySection('Comfort & Ventilation');
  const plumbS   = emptySection('Plumbing & Fixtures');
  const elecS    = emptySection('Lighting & Electrical');
  const tileS    = emptySection('Tile, Niche & Bench');

  // Demolition
  if (a.bath_demo === 'full') {
    pushItem(demoS, 'Full bathroom demolition',
      `Demo all surfaces back to studs and subfloor.${dimensionsToText(a.bath_dims) ? ` Room: ${dimensionsToText(a.bath_dims)}.` : ''} Includes haul-away.`);
  } else if (a.bath_demo === 'partial') {
    pushItem(demoS, 'Partial demolition',
      a.bath_demo_details || 'Selective demo per scope. Includes haul-away.');
  }
  if (a.bath_layout_change === 'yes') {
    pushItem(demoS, 'Layout reconfiguration',
      a.bath_layout_desc || 'Reconfigure layout per client request.');
  }

  // Tub & Shower
  if (a.bath_has_tub === 'yes' && a.bath_tub_action === 'remove') {
    pushItem(tubS, 'Bathtub removal',
      `Remove existing bathtub${a.bath_tub_size ? ` (${a.bath_tub_size})` : ''} and prep for new shower base.`);
  } else if (a.bath_tub_action === 'refinish') {
    pushItem(tubS, 'Bathtub refinishing',
      `Refinish existing tub${a.bath_tub_size ? ` (${a.bath_tub_size})` : ''}.`);
  }
  if (a.bath_freestanding_tub === 'yes') {
    pushItem(tubS, 'Free-standing tub installation',
      a.bath_freestanding_tub_specs || 'Install client-supplied free-standing tub. Includes plumbing rough-in.');
  }
  if (a.bath_has_shower === 'yes') {
    const shDims = dimensionsToText(a.bath_shower_dims);
    pushItem(tubS, 'Shower stall — build out',
      `${shDims ? `Stall ${shDims}.` : ''} ${a.bath_shower_curb_type === 'curbless' ? 'Curbless. ' : a.bath_shower_curb_specs ? `Curb: ${a.bath_shower_curb_specs}. ` : ''}${a.bath_drain ? `Drain: ${a.bath_drain.replace('_', ' ')}.` : ''}`.trim());
    if (a.bath_glass && a.bath_glass !== 'none' && a.bath_glass !== 'curtain') {
      pushItem(tubS, 'Glass enclosure',
        `${a.bath_glass.replace('_', ' ')} glass enclosure. Sub-installed; client supplies glass.`);
    }
  }

  // Toilet & Bidet
  if (a.bath_toilet_action === 'replace') {
    pushItem(toiletS, 'Toilet replacement',
      a.bath_toilet_specs || 'Remove existing and install new toilet (client-supplied).');
  } else if (a.bath_toilet_action === 'relocate') {
    pushItem(toiletS, 'Toilet relocation',
      `${a.bath_toilet_specs || 'Move toilet flange to new position.'} Includes joist verification and floor patching.`);
  }
  if (isYes(a.bath_bidet)) {
    pushItem(toiletS, 'Bidet installation',
      a.bath_bidet_specs || 'Install bidet — verify electrical panel access if powered.');
  }

  // Vanity
  if (a.bath_vanity_action === 'replace') {
    pushItem(vanityS, 'Vanity installation',
      `${a.bath_vanity_type === 'double' ? 'Double-sink' : 'Single-sink'} vanity${a.bath_vanity_size ? ` — ${a.bath_vanity_size}` : ''}. Client-supplied; includes plumbing connections and leveling.`);
  } else if (a.bath_vanity_action === 'refinish') {
    pushItem(vanityS, 'Vanity refinishing',
      'Refinish existing vanity (sand, prime, paint).');
  }
  if (isYes(a.bath_electric_vanity)) {
    pushItem(vanityS, 'Electric vanity wiring',
      a.bath_electric_vanity_specs || 'Wire dedicated circuit for electric vanity.');
  }
  if (isYes(a.bath_electric_towel_rack)) {
    pushItem(vanityS, 'Electric towel rack',
      a.bath_electric_towel_rack_specs || 'Install hardwired heated towel rack — dedicated circuit.');
  }
  if (a.bath_medicine_cabinet && a.bath_medicine_cabinet !== 'none') {
    pushItem(vanityS, `Medicine cabinet (${a.bath_medicine_cabinet.replace('_', ' ')})`,
      a.bath_medicine_cabinet === 'recessed'
        ? 'Frame recessed bay; install client-supplied medicine cabinet.'
        : a.bath_medicine_cabinet === 'electric'
          ? 'Wire dedicated circuit + install electric medicine cabinet.'
          : 'Install surface-mount medicine cabinet.');
  }

  // Comfort & Ventilation
  if (a.bath_exhaust_fan === 'replace') {
    pushItem(comfortS, 'Exhaust fan replacement',
      a.bath_exhaust_fan_specs || 'Replace existing exhaust fan with client-supplied unit.');
  } else if (a.bath_exhaust_fan === 'add') {
    pushItem(comfortS, 'Exhaust fan installation (new)',
      a.bath_exhaust_fan_specs || 'Add new exhaust fan — verify roof or sidewall vent path.');
  }
  if (a.bath_heated_floor === 'electric' || a.bath_heated_floor === 'hydronic') {
    pushItem(comfortS, `Heated floor (${a.bath_heated_floor})`,
      `${a.bath_heated_floor_dims ? `Coverage: ${a.bath_heated_floor_dims} sqft. ` : ''}Includes thermostat install.`);
  }
  if (isYes(a.bath_steam_shower)) {
    pushItem(comfortS, 'Steam shower system',
      a.bath_steam_shower_specs || 'Install steam generator, vapor-proof glass, drainage and controls.');
  }

  // Plumbing
  if (isYes(a.bath_plumbing_reconfig)) {
    pushItem(plumbS, 'Plumbing reconfiguration',
      a.bath_plumbing_reconfig_desc || 'Re-route supply / drain lines per new layout.');
  }
  if (isYes(a.bath_shower_valve)) {
    pushItem(plumbS, 'Shower valve replacement',
      a.bath_shower_valve_specs || 'Install client-supplied shower valve.');
  }
  if (a.bath_shower_head) {
    pushItem(plumbS, 'Shower head installation', a.bath_shower_head);
  }
  if (isYes(a.bath_rain_shower)) {
    pushItem(plumbS, 'Rain shower head',
      a.bath_rain_shower_specs || 'Install rain shower per client spec.');
  }
  if (isYes(a.bath_handheld)) {
    pushItem(plumbS, 'Hand-held shower',
      a.bath_handheld_specs || 'Install slide-bar / wall-mount hand-held.');
  }
  if (isYes(a.bath_water_valve)) {
    pushItem(plumbS, 'Water valve replacement',
      a.bath_water_valve_model || 'Replace water shut-off valves.');
  }

  // Lighting & Electrical
  if (isYes(a.bath_shower_led))            pushItem(elecS, 'Shower LED light (in niche)', 'Wire low-voltage LED inside shower niche.');
  if (isYes(a.bath_led_mirror))            pushItem(elecS, 'LED mirror installation', a.bath_led_mirror_specs || 'Wire and mount client-supplied LED mirror.');
  if (isYes(a.bath_sconces))               pushItem(elecS, 'Sconces installation', a.bath_sconces_specs || 'Wire and mount sconces (client-supplied).');
  if (isYes(a.bath_lighting_replace))      pushItem(elecS, 'General lighting replacement', a.bath_lighting_specs || 'Replace existing fixtures with client-supplied units.');
  if (isYes(a.bath_additional_lights))     pushItem(elecS, 'Additional light fixtures', 'Install supplemental fixtures per layout.');
  if (isYes(a.bath_outlets_switches))      pushItem(elecS, 'Outlet & switch update', a.bath_outlets_model || 'Replace outlets/switches with GFCI where required.');
  if (isYes(a.bath_baseboard_heater))      pushItem(elecS, 'Baseboard heater cover', a.bath_baseboard_heater_specs || 'Replace baseboard heater cover.');
  if (a.bath_panel_capacity === '100')     pushItem(elecS, 'Panel review (100A)', 'Verify panel capacity for added load — upgrade may be needed.');

  // Tile, Niche & Bench
  if (a.bath_tile_material || a.bath_tile_size_pattern) {
    pushItem(tileS, 'Tile installation',
      [a.bath_tile_material && `Material: ${a.bath_tile_material}.`, a.bath_tile_size_pattern && `Size/pattern: ${a.bath_tile_size_pattern}.`, a.bath_tile_height && `Wall height: ${a.bath_tile_height.replace('_', ' ')}.`].filter(Boolean).join(' '));
  }
  if (a.bath_niche === 'one' || a.bath_niche === 'two') {
    pushItem(tileS, `Built-in niche (${a.bath_niche})`,
      a.bath_niche_specs || 'Frame and waterproof niche; tile per shower spec.');
  }
  if (isYes(a.bath_bench)) {
    pushItem(tileS, 'Built-in bench',
      a.bath_bench_specs || 'Frame and waterproof bench; tile per shower spec.');
  }

  return [demoS, tubS, toiletS, vanityS, comfortS, plumbS, elecS, tileS]
    .filter((s) => s.items.length > 0);
}

// ─── KITCHEN ─────────────────────────────────────────────────────────
function kitchenSections(a) {
  const demoS     = emptySection('Demolition & Site Prep');
  const cabS      = emptySection('Cabinetry & Countertop');
  const plumbS    = emptySection('Plumbing & Gas');
  const appliS    = emptySection('Appliances');
  const winDoorS  = emptySection('Windows & Doors');
  const elecS     = emptySection('Lighting & Electrical');
  const finS      = emptySection('Floors, Tile & Trim');

  if (a.kitchen_demo === 'full') {
    pushItem(demoS, 'Full kitchen demolition', a.kitchen_demo_notes || 'Demo all surfaces back to studs and subfloor. Includes haul-away.');
  } else if (a.kitchen_demo === 'partial') {
    pushItem(demoS, 'Partial demolition', a.kitchen_demo_notes || 'Selective demo per scope. Includes haul-away.');
  }
  if (a.kitchen_layout === 'change') {
    pushItem(demoS, 'Layout reconfiguration', a.kitchen_layout_desc || 'Reconfigure kitchen layout per client.');
  }

  // Cabinetry
  if (a.kitchen_cabinet_brand && a.kitchen_cabinet_brand !== 'custom') {
    pushItem(cabS, 'Cabinet installation',
      [
        a.kitchen_cabinet_brand && `Brand: ${a.kitchen_cabinet_brand}.`,
        a.kitchen_cabinet_color && `Color: ${a.kitchen_cabinet_color}.`,
        a.kitchen_cabinet_dims && `Dimensions: ${a.kitchen_cabinet_dims}.`,
      ].filter(Boolean).join(' '));
  } else if (a.kitchen_cabinet_brand === 'custom' && a.kitchen_cabinet_custom_brand) {
    pushItem(cabS, 'Cabinet installation', a.kitchen_cabinet_custom_brand);
  }
  if (a.kitchen_countertop_material) {
    pushItem(cabS, 'Countertop installation',
      [a.kitchen_countertop_material && `Material: ${a.kitchen_countertop_material}.`, a.kitchen_countertop_dims && `Dimensions: ${a.kitchen_countertop_dims}.`].filter(Boolean).join(' '));
  }
  if (isYes(a.kitchen_insulation)) {
    pushItem(cabS, 'Insulation', a.kitchen_insulation_dims || 'Install per code in opened walls.');
  }

  // Plumbing & Gas
  if (a.kitchen_sink_action === 'replace') {
    pushItem(plumbS, 'Sink replacement', a.kitchen_sink_specs || 'Install client-supplied sink. Includes plumbing connections.');
  } else if (a.kitchen_sink_action === 'relocate') {
    pushItem(plumbS, 'Sink relocation', `${a.kitchen_sink_specs || 'Move sink to new location.'} ${a.kitchen_sink_loc ? `Location: ${a.kitchen_sink_loc}.` : ''}`);
  }
  if (isYes(a.kitchen_pot_filler)) {
    pushItem(plumbS, 'Pot filler installation', a.kitchen_pot_filler_loc || 'Run new water line to range area; install pot filler.');
  }
  if (a.kitchen_gas_action === 'install') {
    pushItem(plumbS, 'Gas line installation', a.kitchen_gas_loc || 'Run new gas line per code; verify access below.');
  } else if (a.kitchen_gas_action === 'relocate') {
    pushItem(plumbS, 'Gas line relocation', a.kitchen_gas_loc || 'Relocate existing gas line.');
  }
  if (a.kitchen_hood_action === 'install') {
    pushItem(plumbS, 'Hood installation (new)', a.kitchen_hood_loc || 'Install new range hood with exterior venting.');
  } else if (a.kitchen_hood_action === 'relocate') {
    pushItem(plumbS, 'Hood relocation', a.kitchen_hood_loc || 'Relocate existing hood.');
  }
  if (isYes(a.kitchen_instant_hot)) {
    pushItem(plumbS, 'Instant hot water tank', a.kitchen_instant_hot_specs || 'Install under-sink instant hot water unit.');
  }

  // Appliances — only push items for things that aren't kept/none.
  if (notNoOrEmpty(a.kitchen_microwave))         pushItem(appliS, 'Microwave install', a.kitchen_microwave_loc || `Install ${a.kitchen_microwave.replace('_', ' ')} microwave.`);
  if (notNoOrEmpty(a.kitchen_oven))              pushItem(appliS, 'Oven install', `${a.kitchen_oven.replace('_', ' ')}. ${a.kitchen_oven_size || ''}`.trim());
  if (notNoOrEmpty(a.kitchen_stove))             pushItem(appliS, 'Stove install', `${a.kitchen_stove}${a.kitchen_stove_size ? ` — ${a.kitchen_stove_size}` : ''}.`);
  if (notNoOrEmpty(a.kitchen_cooktop))           pushItem(appliS, 'Cooktop install', `${a.kitchen_cooktop}${a.kitchen_cooktop_size ? ` — ${a.kitchen_cooktop_size}` : ''}.`);
  if (isYes(a.kitchen_burner_rangetop))          pushItem(appliS, 'Burner rangetop install', a.kitchen_burner_rangetop_size || '');
  if (isYes(a.kitchen_steam_oven))               pushItem(appliS, 'Steam oven install', a.kitchen_steam_oven_specs || '');

  // Windows & Doors
  if (a.kitchen_window_action === 'replace' || a.kitchen_window_action === 'relocate') {
    pushItem(winDoorS, `Window ${a.kitchen_window_action}`, a.kitchen_window_loc || '');
  }
  if (a.kitchen_door_action === 'replace' || a.kitchen_door_action === 'relocate') {
    pushItem(winDoorS, `Door ${a.kitchen_door_action}`, a.kitchen_door_loc || '');
  }

  // Lighting & Electrical
  if (isYes(a.kitchen_recessed_light))     pushItem(elecS, 'Recessed lighting', a.kitchen_recessed_specs || 'Install recessed cans per layout.');
  if (isYes(a.kitchen_undercabinet_light)) pushItem(elecS, 'Undercabinet lighting', a.kitchen_undercabinet_specs || 'LED strip lighting under wall cabinets.');
  if (isYes(a.kitchen_sconces))            pushItem(elecS, 'Sconces', a.kitchen_sconces_specs || '');
  if (isYes(a.kitchen_pendants))           pushItem(elecS, 'Pendants', a.kitchen_pendants_specs || '');
  if (a.kitchen_outlets_info)              pushItem(elecS, 'Outlets / switches', a.kitchen_outlets_info);

  // Floors, Tile & Trim
  if (a.kitchen_backsplash_material) {
    pushItem(finS, 'Backsplash installation',
      [a.kitchen_backsplash_material && `Material: ${a.kitchen_backsplash_material}.`, a.kitchen_backsplash_pattern && `Pattern: ${a.kitchen_backsplash_pattern}.`, a.kitchen_backsplash_height === 'full' && 'Full height to ceiling.', a.kitchen_backsplash_height === 'custom' && a.kitchen_backsplash_height_custom].filter(Boolean).join(' '));
  }
  if (a.kitchen_floor_type && a.kitchen_floor_type !== 'keep') {
    pushItem(finS, `Flooring (${a.kitchen_floor_type})`, a.kitchen_floor_specs || 'New flooring per spec.');
  }
  if (isYes(a.kitchen_trim_work))    pushItem(finS, 'Trim & crown molding', a.kitchen_trim_specs || '');
  if (isYes(a.kitchen_painting))     pushItem(finS, 'Painting', a.kitchen_painting_desc || '');

  return [demoS, cabS, plumbS, appliS, winDoorS, elecS, finS]
    .filter((s) => s.items.length > 0);
}

// ─── DECK ────────────────────────────────────────────────────────────
function deckSections(a) {
  const overviewS = emptySection('Site Prep & Demolition');
  const structS   = emptySection('Foundation & Structure');
  const railS     = emptySection('Railings & Posts');
  const surfaceS  = emptySection('Decking Surface');
  const stairsS   = emptySection('Guardrail & Stairs');
  const extrasS   = emptySection('Trim & Extras');

  // Overview / demo
  if (isYes(a.deck_demolition)) {
    pushItem(overviewS, 'Existing deck demolition', `${dimensionsToText(a.deck_dims) ? `Footprint: ${dimensionsToText(a.deck_dims)}.` : ''} Includes haul-away.`);
  }
  if (a.deck_type === 'extension') {
    pushItem(overviewS, 'Deck extension', a.deck_extension_desc || 'Extend existing deck per scope.');
  }
  if (a.deck_building_plans === 'need') {
    pushItem(overviewS, 'Building plans (drafted by Omega)', 'Prepare permit-ready plans.');
  }
  if (a.deck_dims && a.deck_material && (a.deck_type === 'new' || a.deck_type === 'replacement')) {
    pushItem(overviewS, `${a.deck_type === 'new' ? 'New deck build' : 'Deck replacement'}`,
      `${dimensionsToText(a.deck_dims)} ${a.deck_material.replace('_', ' ')} deck. ${a.deck_attachment === 'attached' ? 'Attached to house.' : 'Freestanding.'}${a.deck_height ? ` Height: ${a.deck_height.replace('_', ' ')}.` : ''}`);
  }

  // Structure
  if (isYes(a.deck_footings))           pushItem(structS, 'Concrete footings', `Quantity: ${a.deck_footings_qty || 'TBD'}. Includes excavation and pour.`);
  if (isYes(a.deck_simpson_strong_tie)) pushItem(structS, 'Simpson Strong-Tie hardware', `Quantity: ${a.deck_simpson_qty || 'TBD'}. Includes interior connections.`);
  if (isYes(a.deck_floor_replace))      pushItem(structS, 'Floor replacement', a.deck_floor_specs || '');
  if (isYes(a.deck_stringer_replace))   pushItem(structS, 'Stringer replacement', a.deck_stringer_specs || '');
  if (isYes(a.deck_joist_replace))      pushItem(structS, 'Joist replacement', 'Replace damaged joists.');
  if (isYes(a.deck_beam_replace))       pushItem(structS, 'Beam replacement', 'Replace damaged beam(s).');
  if (isYes(a.deck_rim_board_replace))  pushItem(structS, 'Rim board replacement', 'Replace rim board.');
  if (isYes(a.deck_flashing_replace))   pushItem(structS, 'Flashing replacement', a.deck_flashing_desc || '');
  if (isYes(a.deck_post_install))       pushItem(structS, 'Post installation', `Quantity: ${a.deck_post_install_qty || 'TBD'}.`);
  if (isYes(a.deck_post_replace))       pushItem(structS, 'Post replacement', `Quantity: ${a.deck_post_replace_qty || 'TBD'}.`);

  // Railings
  if (isYes(a.deck_handrail))      pushItem(railS, 'Hand rail (code-compliant)', a.deck_handrail_material || '');
  if (isYes(a.deck_railing))       pushItem(railS, 'Railing system', a.deck_railing_specs || '');
  if (isYes(a.deck_railing_post))  pushItem(railS, 'Railing posts', a.deck_railing_post_specs || '');
  if (isYes(a.deck_post_sleeve))   pushItem(railS, 'Post sleeves', a.deck_post_sleeve_specs || '');
  if (isYes(a.deck_post_skirt))    pushItem(railS, 'Post skirts', a.deck_post_skirt_specs || '');

  // Decking surface
  if (a.deck_board_specs || a.deck_board_type) {
    pushItem(surfaceS, 'Deck board installation',
      `${a.deck_board_type ? a.deck_board_type + ' boards. ' : ''}${a.deck_board_specs || ''}`.trim());
  }
  if (isYes(a.deck_hidden_screws))   pushItem(surfaceS, 'Hidden fastening system', a.deck_hidden_screws_desc || '');
  if (isYes(a.deck_picture_frame))   pushItem(surfaceS, 'Picture-frame trim', a.deck_picture_frame_specs || '');

  // Stairs / guardrail
  if (a.deck_guardrail === 'needed') {
    pushItem(stairsS, 'Guardrail (code-required above 30")', a.deck_guardrail_material ? `Material: ${a.deck_guardrail_material}.` : '');
  }
  if (a.deck_stairs === 'yes') {
    pushItem(stairsS, 'Stair construction', `${a.deck_stair_flights || 1} flight${a.deck_stair_flights === '1' ? '' : 's'}.${a.deck_landing === 'yes' ? ' Includes landing.' : ''}`);
  }

  // Extras
  if (isYes(a.deck_gate))       pushItem(extrasS, 'Gate', a.deck_gate_specs || '');
  if (a.deck_fascia && a.deck_fascia !== 'no')
                                pushItem(extrasS, 'Fascia board', `${a.deck_fascia.replace('_', ' ')}.`);
  if (isYes(a.deck_lattice))    pushItem(extrasS, 'Lattice skirting', `Quantity: ${a.deck_lattice_qty || 'TBD'}.`);
  for (const extra of (a.deck_extras || [])) {
    if (extra === 'pergola')     pushItem(extrasS, 'Pergola / cover', 'Build pergola per design.');
    if (extra === 'bench')       pushItem(extrasS, 'Built-in bench', 'Built-in bench per design.');
    if (extra === 'planter')     pushItem(extrasS, 'Built-in planter', 'Built-in planter per design.');
    if (extra === 'lighting')    pushItem(extrasS, 'Built-in lighting', 'Low-voltage LED, post caps and tread lights.');
    if (extra === 'gas_firepit') pushItem(extrasS, 'Gas line / Firepit', 'Run gas line and install firepit.');
    if (extra === 'hot_tub')     pushItem(extrasS, 'Hot tub pad', 'Reinforce structure for hot tub load.');
  }
  if (a.deck_special_request)   pushItem(extrasS, 'Custom request', a.deck_special_request);

  return [overviewS, structS, railS, surfaceS, stairsS, extrasS]
    .filter((s) => s.items.length > 0);
}

// ─── ROOFING ─────────────────────────────────────────────────────────
function roofingSections(a) {
  const overviewS = emptySection('Roof Replacement');
  const flashS    = emptySection('Flashing & Vents');
  const repairS   = emptySection('Repairs & Gutters');

  if (a.roof_replacement_type === 'full') {
    pushItem(overviewS, 'Full roof replacement',
      `${a.roof_squares ? `${a.roof_squares} squares. ` : ''}${a.roof_layers ? `Tear-off existing ${a.roof_layers} layer(s). ` : ''}${a.roof_material ? `Material: ${a.roof_material.replace('_', ' ')}.` : ''}`);
  } else if (a.roof_replacement_type === 'partial') {
    pushItem(overviewS, 'Partial roof replacement',
      `${a.roof_squares ? `${a.roof_squares} squares.` : ''}`);
  }
  if (a.roof_material === 'asphalt' && a.roof_asphalt_specs)         pushItem(overviewS, 'Asphalt shingles', a.roof_asphalt_specs);
  else if (a.roof_material === 'standing_seam' && a.roof_metal_color) pushItem(overviewS, 'Standing seam metal roofing', `Color: ${a.roof_metal_color}.`);
  else if (a.roof_material === 'cedar')                              pushItem(overviewS, 'Cedar roofing', 'Cedar shake / shingle install.');
  if (isYes(a.roof_underlayment))                                    pushItem(overviewS, 'Underlayment', 'Install synthetic underlayment under shingles.');

  // Flashing
  if (isYes(a.roof_step_flashing))     pushItem(flashS, 'Step flashing', a.roof_step_flashing_specs || '');
  if (isYes(a.roof_eave_flashing))     pushItem(flashS, 'Eave flashing', a.roof_eave_flashing_specs || '');
  if (isYes(a.roof_drip_edge))         pushItem(flashS, 'Drip edge', a.roof_drip_edge_specs || '');
  if (isYes(a.roof_chimney_flashing))  pushItem(flashS, 'Chimney flashing', a.roof_chimney_flashing_specs || '');
  if (isYes(a.roof_boot_pipe))         pushItem(flashS, 'Boot pipe(s)', a.roof_boot_pipe_specs || '');
  if (isYes(a.roof_ridge_vent))        pushItem(flashS, 'Ridge vent', a.roof_ridge_vent_size || '');

  // Repairs
  if (isYes(a.roof_plywood_replace))   pushItem(repairS, 'Plywood deck replacement', a.roof_plywood_qty ? `Quantity: ${a.roof_plywood_qty}.` : 'As needed during tear-off.');
  if (isYes(a.roof_gutter_replace))    pushItem(repairS, 'Gutter replacement', a.roof_gutter_specs || '');
  if (a.roof_other_request)            pushItem(repairS, 'Special request', a.roof_other_request);

  return [overviewS, flashS, repairS].filter((s) => s.items.length > 0);
}

// ─── Public API ──────────────────────────────────────────────────────
// Service id → mapper. Anything not in the table returns no auto-fill
// (the Generate button hides itself in that case).
const MAPPERS = {
  bathroom: bathroomSections,
  kitchen:  kitchenSections,
  deck:     deckSections,
  roofing:  roofingSections,
};

export function canAutofill(serviceId) {
  return !!MAPPERS[String(serviceId || '').toLowerCase()];
}

// Build a draft section list out of a job's questionnaire answers.
// Returns an array of `{ title, items: [...] }` ready to drop into
// EstimateBuilder's `sections` state. Empty sections are filtered out
// so the seller never sees a blank "Plumbing" header just because the
// client didn't pick any plumbing options.
//
// `services` is the comma-separated `jobs.service` string; we run the
// mapper for each one and concatenate the result so a Bathroom +
// Kitchen job shows both groups stacked.
export function autofillSectionsFromAnswers(services, answers) {
  const ids = String(services || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const a = answers || {};
  const out = [];
  for (const id of ids) {
    const fn = MAPPERS[id];
    if (!fn) continue;
    const sections = fn(a);
    out.push(...sections);
  }
  return out;
}
