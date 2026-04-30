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

// ─── FLOORING ────────────────────────────────────────────────────────
// Maps the flooring questionnaire (15 fields, see questionnaire.js)
// into a draft estimate. Empty sections are filtered out at the end.
function flooringSections(a) {
  const overviewS = emptySection('Project Overview');
  const removeS   = emptySection('Existing Floor Removal');
  const subS      = emptySection('Subfloor Prep');
  const installS  = emptySection('New Flooring Installation');
  const trimS     = emptySection('Baseboards & Transitions');
  const stairsS   = emptySection('Stairs');
  const logS      = emptySection('Logistics');

  // Overview
  if (Array.isArray(a.floor_areas) && a.floor_areas.length) {
    const labels = {
      living: 'Living Room', dining: 'Dining Room', kitchen: 'Kitchen',
      hallway: 'Hallway', bedroom: 'Bedrooms', bathroom: 'Bathrooms',
      basement: 'Basement', whole: 'Whole house',
    };
    const rooms = a.floor_areas.map((k) => labels[k] || k).join(', ');
    pushItem(overviewS, 'Areas covered',
      `${rooms}${a.floor_total_sqft ? ` · ${a.floor_total_sqft} sq ft total.` : '.'}`);
  } else if (a.floor_total_sqft) {
    pushItem(overviewS, 'Total area', `${a.floor_total_sqft} sq ft.`);
  }

  // Existing floor removal
  if (a.floor_existing_remove === 'yes') {
    pushItem(removeS, 'Existing floor removal',
      `Remove and haul away existing ${a.floor_existing_type || 'floor'}.`);
  } else if (a.floor_existing_remove === 'no') {
    pushItem(removeS, 'Install over existing',
      `New floor will be installed directly over the existing ${a.floor_existing_type || 'surface'}.`);
  }

  // Subfloor
  if (a.floor_subfloor === 'minor') {
    pushItem(subS, 'Subfloor patching', 'Minor patching of subfloor before install.');
  } else if (a.floor_subfloor === 'replace') {
    pushItem(subS, 'Partial subfloor replacement',
      'Replace damaged subfloor sections as needed before install.');
  } else if (a.floor_subfloor === 'unknown') {
    pushItem(subS, 'Subfloor inspection',
      'Inspect subfloor on demo and quote any required repairs as a change order.');
  }

  // New flooring install
  if (a.floor_new_material) {
    const matLabels = {
      hardwood:   'Solid hardwood',
      engineered: 'Engineered wood',
      lvp:        'LVP / vinyl plank',
      laminate:   'Laminate',
      tile:       'Tile / porcelain',
      carpet:     'Carpet',
      concrete:   'Polished concrete',
    };
    const mat = matLabels[a.floor_new_material] || a.floor_new_material;
    const detailParts = [];
    if (a.floor_material_brand) detailParts.push(`Brand/line: ${a.floor_material_brand}.`);
    if (a.floor_material_color) detailParts.push(`Color: ${a.floor_material_color}.`);
    if (a.floor_pattern && a.floor_pattern !== 'straight') {
      detailParts.push(`Install pattern: ${a.floor_pattern}.`);
    }
    pushItem(installS, `${mat} install`,
      `Supply${a.floor_material_brand ? ' (or accept client-supplied)' : ''} and install ${mat.toLowerCase()}${a.floor_total_sqft ? ` over ${a.floor_total_sqft} sq ft` : ''}. ${detailParts.join(' ')}`.trim());
  }

  // Baseboards
  if (a.floor_baseboards === 'replace') {
    pushItem(trimS, 'Baseboard replacement', 'Remove existing baseboards and install new.');
  } else if (a.floor_baseboards === 'new') {
    pushItem(trimS, 'New baseboards', 'Install baseboards where currently missing.');
  }

  // Transitions
  if (a.floor_transitions && a.floor_transitions !== 'na') {
    const tLabels = {
      match:    'Matching transition strips at doors and room boundaries.',
      contrast: 'Contrasting transition strips at doors and room boundaries.',
      flush:    'Flush transitions (no strip) at doors and room boundaries.',
    };
    pushItem(trimS, 'Door / room transitions', tLabels[a.floor_transitions] || '');
  }

  // Stairs
  if (a.floor_stairs === 'yes') {
    pushItem(stairsS, 'Stair flooring',
      `${a.floor_stair_count ? `${a.floor_stair_count} treads. ` : ''}Install material to match floor; rounded nosing on each tread.`);
  }

  // Logistics
  if (a.floor_furniture === 'omega') {
    pushItem(logS, 'Furniture moving',
      'Omega moves and re-positions furniture before and after install.');
  }
  if (a.floor_timeline === 'rush') {
    pushItem(logS, 'Rush schedule', 'Project to be completed within 1-2 weeks of start.');
  }

  return [overviewS, removeS, subS, installS, trimS, stairsS, logS]
    .filter((s) => s.items.length > 0);
}

// ─── STARTER PACKS (services without a questionnaire) ───────────────
// Generic-but-useful section/item skeletons for jobs that don't go
// through a detailed questionnaire. Items have empty scope and price 0
// — the seller fills both based on the actual conversation with the
// client. Feels like ~30 seconds of work to delete what doesn't apply
// instead of staring at a blank estimate.
//
// Each starter pack ignores `a` entirely (no questionnaire to read).

function additionStarter(_a) {
  return [
    { title: 'Site Prep & Demolition',
      items: [
        { description: 'Excavation and site preparation', scope: '', price: 0 },
        { description: 'Removal of existing structures (if any)', scope: '', price: 0 },
        { description: 'Hauling and disposal',                   scope: '', price: 0 },
      ] },
    { title: 'Foundation',
      items: [
        { description: 'Footings and foundation walls', scope: '', price: 0 },
        { description: 'Slab pour',                     scope: '', price: 0 },
        { description: 'Waterproofing',                 scope: '', price: 0 },
      ] },
    { title: 'Framing',
      items: [
        { description: 'Floor structure',  scope: '', price: 0 },
        { description: 'Wall framing',     scope: '', price: 0 },
        { description: 'Roof structure',   scope: '', price: 0 },
      ] },
    { title: 'Exterior Envelope',
      items: [
        { description: 'Sheathing and weather barrier', scope: '', price: 0 },
        { description: 'Roofing tie-in to existing',     scope: '', price: 0 },
        { description: 'Siding to match existing',       scope: '', price: 0 },
        { description: 'Windows and exterior doors',     scope: '', price: 0 },
      ] },
    { title: 'MEP Rough-in',
      items: [
        { description: 'Plumbing rough-in',  scope: '', price: 0 },
        { description: 'Electrical rough-in', scope: '', price: 0 },
        { description: 'HVAC tie-in / new system', scope: '', price: 0 },
      ] },
    { title: 'Insulation & Drywall',
      items: [
        { description: 'Insulation (walls, ceiling, floor)', scope: '', price: 0 },
        { description: 'Drywall, taping and finishing',       scope: '', price: 0 },
      ] },
    { title: 'Interior Finishes',
      items: [
        { description: 'Interior doors and trim', scope: '', price: 0 },
        { description: 'Paint',                   scope: '', price: 0 },
        { description: 'Flooring',                scope: '', price: 0 },
      ] },
    { title: 'Permits & Closeout',
      items: [
        { description: 'Permit fees (passed through to client)', scope: '', price: 0 },
        { description: 'Final inspection and punch list',         scope: '', price: 0 },
      ] },
  ];
}

function basementStarter(_a) {
  return [
    { title: 'Site Prep',
      items: [
        { description: 'Cleanup of existing basement',   scope: '', price: 0 },
        { description: 'Moisture inspection / mitigation', scope: '', price: 0 },
      ] },
    { title: 'Framing',
      items: [
        { description: 'Wall framing',   scope: '', price: 0 },
        { description: 'Soffits / drops to hide ducting and beams', scope: '', price: 0 },
      ] },
    { title: 'Insulation & Vapor Barrier',
      items: [
        { description: 'Vapor barrier behind framed walls', scope: '', price: 0 },
        { description: 'Wall and ceiling insulation',        scope: '', price: 0 },
      ] },
    { title: 'MEP Rough-in',
      items: [
        { description: 'Electrical rough-in (outlets, switches, lights)', scope: '', price: 0 },
        { description: 'Plumbing rough-in (only if a bathroom is included)', scope: '', price: 0 },
        { description: 'HVAC extension from existing system',              scope: '', price: 0 },
      ] },
    { title: 'Drywall & Finish',
      items: [
        { description: 'Drywall, taping and finishing', scope: '', price: 0 },
        { description: 'Paint',                          scope: '', price: 0 },
        { description: 'Interior doors and trim',         scope: '', price: 0 },
      ] },
    { title: 'Flooring',
      items: [
        { description: 'New flooring (LVP, tile or carpet — confirm with client)', scope: '', price: 0 },
      ] },
    { title: 'Code Compliance',
      items: [
        { description: 'Egress window install (if required by code)', scope: '', price: 0 },
        { description: 'Smoke / CO detectors',                         scope: '', price: 0 },
      ] },
  ];
}

function drivewayStarter(_a) {
  return [
    { title: 'Site Prep',
      items: [
        { description: 'Removal of existing driveway surface (if any)', scope: '', price: 0 },
        { description: 'Excavation and grading',                          scope: '', price: 0 },
        { description: 'Hauling and disposal',                            scope: '', price: 0 },
      ] },
    { title: 'Base & Drainage',
      items: [
        { description: 'Compacted gravel base',                  scope: '', price: 0 },
        { description: 'Drainage tie-in or French drain (if needed)', scope: '', price: 0 },
      ] },
    { title: 'Surface',
      items: [
        { description: 'Surface install (asphalt / concrete / pavers — confirm with client)', scope: '', price: 0 },
        { description: 'Edging or borders',                                                    scope: '', price: 0 },
        { description: 'Sealing (asphalt only)',                                                scope: '', price: 0 },
      ] },
    { title: 'Apron & Cleanup',
      items: [
        { description: 'Apron / curb cut (if required by town)', scope: '', price: 0 },
        { description: 'Final cleanup and re-grading of edges',   scope: '', price: 0 },
      ] },
  ];
}

function surveyStarter(_a) {
  return [
    { title: 'Survey Work',
      items: [
        { description: 'Site visit and walk-through',          scope: '', price: 0 },
        { description: 'Boundary survey',                       scope: '', price: 0 },
        { description: 'Topographic mapping',                   scope: '', price: 0 },
        { description: 'Stake placement at corners',            scope: '', price: 0 },
      ] },
    { title: 'Deliverables',
      items: [
        { description: 'Stamped survey PDF',                    scope: '', price: 0 },
        { description: 'Electronic file (CAD / shapefile)',      scope: '', price: 0 },
      ] },
  ];
}

function buildingPlansStarter(_a) {
  return [
    { title: 'Design',
      items: [
        { description: 'Initial site review and measurements',   scope: '', price: 0 },
        { description: 'Schematic design / concepts',            scope: '', price: 0 },
        { description: 'Design development with client',         scope: '', price: 0 },
      ] },
    { title: 'Construction Documents',
      items: [
        { description: 'Floor plans',                            scope: '', price: 0 },
        { description: 'Elevations',                              scope: '', price: 0 },
        { description: 'Sections and details',                    scope: '', price: 0 },
        { description: 'Structural notes',                        scope: '', price: 0 },
      ] },
    { title: 'Permit Package',
      items: [
        { description: 'Permit application drawings',            scope: '', price: 0 },
        { description: 'Revisions per municipal feedback',       scope: '', price: 0 },
      ] },
  ];
}

function fullrenoStarter(_a) {
  return [
    { title: 'Demolition & Site Prep',
      items: [
        { description: 'Selective or full demolition',           scope: '', price: 0 },
        { description: 'Floor and surface protection',           scope: '', price: 0 },
        { description: 'Hauling and disposal',                    scope: '', price: 0 },
      ] },
    { title: 'Structural Changes',
      items: [
        { description: 'New layout framing changes',             scope: '', price: 0 },
        { description: 'Beam install or wall removal (if required)', scope: '', price: 0 },
      ] },
    { title: 'MEP Rough-in',
      items: [
        { description: 'Plumbing rough-in',                       scope: '', price: 0 },
        { description: 'Electrical rough-in',                     scope: '', price: 0 },
        { description: 'HVAC update',                              scope: '', price: 0 },
      ] },
    { title: 'Insulation & Drywall',
      items: [
        { description: 'Insulation (where opened up)',            scope: '', price: 0 },
        { description: 'Drywall, taping and finishing',           scope: '', price: 0 },
      ] },
    { title: 'Kitchen Renovation',
      items: [
        { description: 'Cabinets and countertops',                scope: '', price: 0 },
        { description: 'Backsplash',                                scope: '', price: 0 },
        { description: 'Appliances install',                       scope: '', price: 0 },
      ] },
    { title: 'Bathroom(s) Renovation',
      items: [
        { description: 'Bathroom #1 — fixtures, tile, vanity',     scope: '', price: 0 },
        { description: 'Additional bathrooms (if any)',            scope: '', price: 0 },
      ] },
    { title: 'Flooring & Finishes',
      items: [
        { description: 'Flooring throughout',                       scope: '', price: 0 },
        { description: 'Interior doors, trim and millwork',         scope: '', price: 0 },
        { description: 'Paint',                                      scope: '', price: 0 },
      ] },
    { title: 'Permits & Closeout',
      items: [
        { description: 'Permit fees (passed through to client)',    scope: '', price: 0 },
        { description: 'Final inspection and punch list',            scope: '', price: 0 },
      ] },
  ];
}

function newconstructionStarter(_a) {
  return [
    { title: 'Site Prep',
      items: [
        { description: 'Excavation, grading and erosion control', scope: '', price: 0 },
        { description: 'Utility tie-ins (water, sewer, electric, gas)', scope: '', price: 0 },
      ] },
    { title: 'Foundation',
      items: [
        { description: 'Footings, foundation walls and slab',     scope: '', price: 0 },
        { description: 'Waterproofing and drainage',                scope: '', price: 0 },
      ] },
    { title: 'Framing',
      items: [
        { description: 'Floor structure',                           scope: '', price: 0 },
        { description: 'Wall framing (all floors)',                  scope: '', price: 0 },
        { description: 'Roof structure',                             scope: '', price: 0 },
      ] },
    { title: 'Exterior Envelope',
      items: [
        { description: 'Sheathing and weather barrier',           scope: '', price: 0 },
        { description: 'Roofing',                                    scope: '', price: 0 },
        { description: 'Siding',                                     scope: '', price: 0 },
        { description: 'Windows and exterior doors',                 scope: '', price: 0 },
      ] },
    { title: 'MEP Rough-in',
      items: [
        { description: 'Plumbing rough-in (entire house)',         scope: '', price: 0 },
        { description: 'Electrical rough-in (entire house)',         scope: '', price: 0 },
        { description: 'HVAC system install',                        scope: '', price: 0 },
      ] },
    { title: 'Insulation & Drywall',
      items: [
        { description: 'Insulation (walls, ceilings, floors)',     scope: '', price: 0 },
        { description: 'Drywall, taping and finishing',             scope: '', price: 0 },
      ] },
    { title: 'Interior Finishes',
      items: [
        { description: 'Kitchen install',                           scope: '', price: 0 },
        { description: 'Bathroom(s) install',                        scope: '', price: 0 },
        { description: 'Interior doors, trim and millwork',          scope: '', price: 0 },
        { description: 'Flooring throughout',                         scope: '', price: 0 },
        { description: 'Paint',                                       scope: '', price: 0 },
      ] },
    { title: 'Permits & Closeout',
      items: [
        { description: 'Permit fees (passed through to client)',    scope: '', price: 0 },
        { description: 'Inspections (framing, MEP rough, final)',    scope: '', price: 0 },
        { description: 'Certificate of Occupancy',                   scope: '', price: 0 },
        { description: 'Final punch list',                            scope: '', price: 0 },
      ] },
  ];
}

// ─── STARTER PACKS for the 5 services that DO have a questionnaire ──
// These are the fallback when the seller hits Autofill before answering
// any of the questionnaire (or after answering only items that produced
// nothing). Same shape as the no-questionnaire starters above.

function bathroomStarter(_a) {
  return [
    { title: 'Demolition & Site Prep',
      items: [
        { description: 'Demolition of existing bathroom', scope: '', price: 0 },
        { description: 'Floor and adjacent area protection', scope: '', price: 0 },
        { description: 'Hauling and disposal',                scope: '', price: 0 },
      ] },
    { title: 'Plumbing',
      items: [
        { description: 'Plumbing rough-in (supply and drain)', scope: '', price: 0 },
        { description: 'Fixture installation (toilet, faucets, valves)', scope: '', price: 0 },
      ] },
    { title: 'Tub / Shower',
      items: [
        { description: 'Tub or shower base install',     scope: '', price: 0 },
        { description: 'Shower walls (tile or surround)', scope: '', price: 0 },
        { description: 'Shower glass or curtain rod',     scope: '', price: 0 },
      ] },
    { title: 'Vanity & Cabinetry',
      items: [
        { description: 'Vanity install with countertop', scope: '', price: 0 },
        { description: 'Mirror and accessories',          scope: '', price: 0 },
      ] },
    { title: 'Electrical & Ventilation',
      items: [
        { description: 'Lighting (vanity + ceiling)', scope: '', price: 0 },
        { description: 'GFCI outlets',                 scope: '', price: 0 },
        { description: 'Ventilation fan',              scope: '', price: 0 },
      ] },
    { title: 'Tile & Finishes',
      items: [
        { description: 'Floor tile install',           scope: '', price: 0 },
        { description: 'Wall tile install (where applicable)', scope: '', price: 0 },
        { description: 'Grout and seal',                scope: '', price: 0 },
      ] },
    { title: 'Paint & Trim',
      items: [
        { description: 'Paint walls and ceiling', scope: '', price: 0 },
        { description: 'Baseboards and trim',      scope: '', price: 0 },
      ] },
  ];
}

function kitchenStarter(_a) {
  return [
    { title: 'Demolition & Site Prep',
      items: [
        { description: 'Demolition of existing kitchen', scope: '', price: 0 },
        { description: 'Floor and adjacent area protection', scope: '', price: 0 },
        { description: 'Hauling and disposal',                scope: '', price: 0 },
      ] },
    { title: 'Plumbing & Electrical Rough-in',
      items: [
        { description: 'Plumbing rough-in (sink, dishwasher, ice maker)', scope: '', price: 0 },
        { description: 'Electrical rough-in (outlets, lights, appliance circuits)', scope: '', price: 0 },
      ] },
    { title: 'Cabinets & Countertops',
      items: [
        { description: 'Cabinet install (base + uppers)', scope: '', price: 0 },
        { description: 'Countertops install',              scope: '', price: 0 },
        { description: 'Backsplash install',                scope: '', price: 0 },
      ] },
    { title: 'Appliances & Fixtures',
      items: [
        { description: 'Appliance install (range, dishwasher, fridge, microwave)', scope: '', price: 0 },
        { description: 'Sink and faucet install',           scope: '', price: 0 },
        { description: 'Disposal install',                   scope: '', price: 0 },
      ] },
    { title: 'Lighting & Finishes',
      items: [
        { description: 'Pendant lights and recessed lighting', scope: '', price: 0 },
        { description: 'Under-cabinet lighting',                scope: '', price: 0 },
        { description: 'Paint walls and ceiling',                scope: '', price: 0 },
      ] },
    { title: 'Flooring',
      items: [
        { description: 'Kitchen flooring install (if part of scope)', scope: '', price: 0 },
      ] },
  ];
}

function deckStarter(_a) {
  return [
    { title: 'Demolition & Site Prep',
      items: [
        { description: 'Demo existing deck (if any)', scope: '', price: 0 },
        { description: 'Hauling and disposal',         scope: '', price: 0 },
      ] },
    { title: 'Foundation',
      items: [
        { description: 'Concrete footings to frost line', scope: '', price: 0 },
        { description: 'Post bases / brackets',            scope: '', price: 0 },
      ] },
    { title: 'Framing',
      items: [
        { description: 'Posts and beams',           scope: '', price: 0 },
        { description: 'Joists and ledger board',    scope: '', price: 0 },
        { description: 'Blocking and bracing',       scope: '', price: 0 },
      ] },
    { title: 'Decking Surface',
      items: [
        { description: 'Decking boards (composite or pressure-treated)', scope: '', price: 0 },
        { description: 'Fascia boards',                                    scope: '', price: 0 },
      ] },
    { title: 'Railings & Stairs',
      items: [
        { description: 'Railing install',  scope: '', price: 0 },
        { description: 'Stairs and landing', scope: '', price: 0 },
      ] },
    { title: 'Finishes & Permits',
      items: [
        { description: 'Stain or seal (PT only)',                     scope: '', price: 0 },
        { description: 'Permit fees (passed through to client)',      scope: '', price: 0 },
      ] },
  ];
}

function roofingStarter(_a) {
  return [
    { title: 'Tear-off & Disposal',
      items: [
        { description: 'Tear-off existing layers', scope: '', price: 0 },
        { description: 'Hauling and disposal',     scope: '', price: 0 },
      ] },
    { title: 'Roof Deck & Underlayment',
      items: [
        { description: 'Plywood deck repairs (as needed)', scope: '', price: 0 },
        { description: 'Ice & water shield',                scope: '', price: 0 },
        { description: 'Synthetic underlayment',             scope: '', price: 0 },
      ] },
    { title: 'Shingles / Panels',
      items: [
        { description: 'Shingles or metal panels install', scope: '', price: 0 },
        { description: 'Ridge cap',                         scope: '', price: 0 },
      ] },
    { title: 'Flashing & Vents',
      items: [
        { description: 'Step and chimney flashing', scope: '', price: 0 },
        { description: 'Drip edge',                  scope: '', price: 0 },
        { description: 'Pipe boots and vents',        scope: '', price: 0 },
        { description: 'Ridge vent',                  scope: '', price: 0 },
      ] },
    { title: 'Cleanup',
      items: [
        { description: 'Magnetic sweep for nails',        scope: '', price: 0 },
        { description: 'Final cleanup of property and gutters', scope: '', price: 0 },
      ] },
  ];
}

function flooringStarter(_a) {
  return [
    { title: 'Existing Floor Removal',
      items: [
        { description: 'Remove existing floor and haul away', scope: '', price: 0 },
      ] },
    { title: 'Subfloor Prep',
      items: [
        { description: 'Subfloor inspection and prep', scope: '', price: 0 },
        { description: 'Patching or partial replacement (as needed)', scope: '', price: 0 },
      ] },
    { title: 'New Flooring Installation',
      items: [
        { description: 'New flooring install (material TBD with client)', scope: '', price: 0 },
      ] },
    { title: 'Baseboards & Transitions',
      items: [
        { description: 'Baseboards (replace or new)',                scope: '', price: 0 },
        { description: 'Door / room transitions',                     scope: '', price: 0 },
      ] },
    { title: 'Stairs',
      items: [
        { description: 'Stair flooring (if included)', scope: '', price: 0 },
      ] },
    { title: 'Logistics',
      items: [
        { description: 'Furniture moving (if Omega handles it)', scope: '', price: 0 },
      ] },
  ];
}

// ─── Public API ──────────────────────────────────────────────────────
// Each service registers a `starter` (always-on fallback skeleton) and
// optionally a `fromQuestionnaire` mapper that uses the seller's
// answers when they exist. autofillSectionsFromAnswers tries the
// questionnaire mapper first and falls back to the starter when the
// answers didn't produce any sections — that way the Autofill button
// always does something useful, whether the seller went through the
// questionnaire or not.
const MAPPERS = {
  // Services WITH a questionnaire — questionnaire-driven first, starter
  // as fallback when there are no useful answers yet.
  bathroom: { fromQuestionnaire: bathroomSections, starter: bathroomStarter },
  kitchen:  { fromQuestionnaire: kitchenSections,  starter: kitchenStarter  },
  deck:     { fromQuestionnaire: deckSections,     starter: deckStarter     },
  roofing:  { fromQuestionnaire: roofingSections,  starter: roofingStarter  },
  flooring: { fromQuestionnaire: flooringSections, starter: flooringStarter },
  // Services WITHOUT a questionnaire — starter only.
  addition:        { starter: additionStarter },
  basement:        { starter: basementStarter },
  driveway:        { starter: drivewayStarter },
  survey:          { starter: surveyStarter },
  building_plans:  { starter: buildingPlansStarter },
  fullreno:        { starter: fullrenoStarter },
  newconstruction: { starter: newconstructionStarter },
};

export function canAutofill(serviceId) {
  return !!MAPPERS[String(serviceId || '').toLowerCase()];
}

// Build a draft section list out of a job's questionnaire answers.
// Returns an array of `{ title, items: [...] }` ready to drop into
// EstimateBuilder's `sections` state.
//
// Per service, the priority is:
//   1. fromQuestionnaire(answers) — if registered AND it produces
//      at least one non-empty section. The seller answered enough of
//      the questionnaire that we can draft a tailored estimate.
//   2. starter(answers) — generic skeleton for that service type.
//      Always wins when (1) returns nothing or isn't registered.
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
    const mapper = MAPPERS[id];
    if (!mapper) continue;

    // 1. Try the questionnaire-driven mapper when one is registered.
    let sections = [];
    if (typeof mapper.fromQuestionnaire === 'function') {
      sections = mapper.fromQuestionnaire(a) || [];
    }

    // 2. Fall back to the always-on starter pack when the questionnaire
    //    produced nothing (no answers yet, or all answers were "no").
    if (sections.length === 0 && typeof mapper.starter === 'function') {
      sections = mapper.starter(a) || [];
    }

    out.push(...sections);
  }
  return out;
}
