// Phase breakdown templates per service type.
// Each service has an ordered list of phases; each phase has a list of
// sub-items. A phase is considered "completed" when ALL of its items have
// `done: true`.
//
// The template is used to seed a job's `phase_data` JSONB column in Supabase
// the first time it is opened. Subsequent edits persist in `phase_data` and
// the template is not re-applied.

function p(id, name, items) {
  return {
    id,
    name,
    completed: false,
    items: items.map((label, i) => ({ id: `${id}_${i + 1}`, label, done: false })),
  };
}

export const PHASE_TEMPLATES = {
  deck: [
    p('permit', 'Permit Application & Approval', [
      'Permit submitted',
      'Plan review in progress',
      'Revisions requested',
      'Plans resubmitted',
      'Permit approved',
      'Permit fees paid',
      'Permit issued',
      'Inspection schedule defined',
    ]),
    p('excavation', 'Excavation & Footings', [
      'Site preparation',
      'Utilities located (811 check)',
      'Layout marked (string lines / batter boards)',
      'Site excavated',
      'Footing holes dug',
      'Soil inspection (if required)',
      'Sono tubes installed',
      'Rebar installed (if necessary)',
      'Pour concrete',
      'Anchor bolts / post base installed',
      'Concrete cure/dry',
    ]),
    p('framing', 'Framing', [
      'Ledger board installed',
      'Flashing installed',
      'Waterproofing at house connection',
      'Posts installed',
      'Beams installed',
      'Joists installed',
      'Joist hangers installed',
      'Blocking installed',
      'Rim joist installed',
      'Stairs framed',
      'Stringers cut and installed',
      'Landing framed',
    ]),
    p('decking', 'Decking Installation', [
      'Deck boards material delivery',
      'Deck boards layout planning',
      'First board alignment',
      'Deck boards installed',
      'Spacing/gap check',
      'Hidden fasteners or screws installation',
      'Board cutting & edge finishing',
      'Picture framing (if applicable)',
      'Expansion gap check',
      'Surface leveling check',
    ]),
    p('railings', 'Railings, Stairs & Fascia', [
      'Railing posts installed',
      'Top and bottom rails installed',
      'Balusters/spindles installed',
      'Stair stringers finalized',
      'Stair treads installed',
      'Stair risers (if applicable)',
      'Handrails installed',
      'Fascia boards installed',
      'Trim and finishing details',
      'Post caps / decorative elements',
      'Gate installation (if applicable)',
    ]),
    p('final', 'Final Inspection & CO', [
      'Site cleanup',
      'Debris removal',
      'Fastener check',
      'Structural connections check',
      'Railing code compliance check',
      'Stair safety check',
      'Final walkthrough (internal)',
      'Punch list items fixed',
      'Final inspection scheduled',
      'Final inspection passed',
      'Project sign-off',
    ]),
  ],

  kitchen: [
    p('permit', 'Permit Application & Approval', [
      'Permit submitted',
      'Plan review in progress',
      'Revisions requested',
      'Plans resubmitted',
      'Permit approved',
      'Permit fees paid',
      'Permit issued',
      'Inspection schedule defined',
    ]),
    p('demo', 'Demo & Debris Removal', [
      'Site protection (floors, walls, adjacent areas)',
      'Utilities shut off (electrical, plumbing, gas)',
      'Cabinet removal',
      'Countertop removal',
      'Appliance removal',
      'Flooring demo (if applicable)',
      'Wall demo (if applicable)',
      'Debris removal & disposal',
      'Site cleaned & prepped',
    ]),
    p('rough_in', 'Rough-In', [
      'Plumbing rough-in (drain, supply lines)',
      'Electrical rough-in (circuits, outlets, lighting)',
      'HVAC/ventilation rough-in',
      'Gas line rough-in (if applicable)',
      'Inspections passed (plumbing, electrical)',
      'Insulation installed',
      'Walls closed up (drywall)',
    ]),
    p('drywall_paint', 'Drywall, Insulation & Painting', [
      'Drywall installed',
      'Drywall taped & mudded',
      'Sanding & skim coat',
      'Primer applied',
      'Paint first coat',
      'Paint second coat',
      'Ceiling finished',
      'Touch-ups completed',
    ]),
    p('cabinets', 'Cabinets, Countertops & Backsplash', [
      'Cabinet delivery & inspection',
      'Upper cabinets installed',
      'Lower cabinets installed',
      'Cabinet hardware installed',
      'Countertop template measured',
      'Countertop fabricated',
      'Countertop installed',
      'Sink cutout & undermount installed',
      'Backsplash layout planned',
      'Backsplash installed & grouted',
      'Caulking & sealing completed',
    ]),
    p('appliances', 'Appliances, Fixtures & Final Touches', [
      'Plumbing fixtures installed',
      'Electrical fixtures installed',
      'Appliances installed',
      'Flooring installed (if in scope)',
      'Trim & molding installed',
      'Touch-up painting',
      'Hardware final check',
    ]),
    p('final', 'Final Inspection & CO', [
      'Site cleanup',
      'Debris removal',
      'All connections checked',
      'Cabinet & drawer function check',
      'Appliance function check',
      'Code compliance check',
      'Final walkthrough (internal)',
      'Punch list items fixed',
      'Final inspection scheduled',
      'Final inspection passed',
      'Certificate of Occupancy issued',
      'Project sign-off',
    ]),
  ],

  bathroom: [
    p('permit', 'Permit Application & Approval', [
      'Permit submitted',
      'Plan review in progress',
      'Revisions requested',
      'Plans resubmitted',
      'Permit approved',
      'Permit fees paid',
      'Permit issued',
      'Inspection schedule defined',
    ]),
    p('demo', 'Demo & Debris Removal', [
      'Site protection',
      'Utilities shut off',
      'Fixture removal (toilet, vanity, tub/shower)',
      'Tile demo (floor & walls)',
      'Flooring demo',
      'Drywall demo (if applicable)',
      'Debris removal & disposal',
      'Site cleaned & prepped',
    ]),
    p('rough_in', 'Rough-In Plumbing & Waterproofing', [
      'Plumbing rough-in',
      'Supply lines rough-in',
      'Electrical rough-in (GFCI, lighting, exhaust)',
      'Inspections passed',
      'Cement board / backer board installed',
      'Waterproofing membrane applied',
      'Waterproofing flood test',
      'Niche/shelf framing (if applicable)',
      'Schluter/edge trim installed',
    ]),
    p('tile', 'Tile, Flooring & Wall Finishes', [
      'Floor tile layout planned',
      'Floor tile installed',
      'Floor tile grouted & sealed',
      'Wall tile layout planned',
      'Wall tile installed',
      'Wall tile grouted & sealed',
      'Shower/tub surround completed',
      'Grout sealed',
      'Transition strips installed',
      'Paint applied (non-tiled areas)',
    ]),
    p('vanity', 'Vanity, Fixtures & Glass', [
      'Vanity installed',
      'Vanity top & sink installed',
      'Faucet installed',
      'Toilet installed',
      'Tub/shower valve & trim installed',
      'Shower door or glass enclosure installed',
      'Mirror & medicine cabinet installed',
      'Exhaust fan installed',
      'Light fixtures installed',
      'Accessories installed',
      'Caulking completed',
    ]),
    p('final', 'Final Inspection & CO', [
      'Site cleanup',
      'Debris removal',
      'All fixtures function check',
      'Plumbing leak check',
      'GFCI outlets tested',
      'Waterproofing verified',
      'Grout & caulk inspection',
      'Final walkthrough (internal)',
      'Punch list items fixed',
      'Final inspection scheduled',
      'Final inspection passed',
      'Certificate of Occupancy issued',
      'Project sign-off',
    ]),
  ],

  addition: [
    p('permit', 'Permit Application & Approval', [
      'Permit submitted',
      'Structural drawings submitted',
      'Plan review in progress',
      'Revisions requested',
      'Plans resubmitted',
      'Permit approved',
      'Permit fees paid',
      'Permit issued',
      'Zoning & setback confirmed',
      'Inspection schedule defined',
    ]),
    p('foundation', 'Excavation & Foundation', [
      'Site preparation',
      'Utilities located (811 check)',
      'Layout marked (batter boards & string lines)',
      'Excavation completed',
      'Soil inspection (if required)',
      'Footings formed & poured',
      'Rebar installed',
      'Foundation walls formed & poured',
      'Anchor bolts installed',
      'Waterproofing applied (foundation exterior)',
      'Backfill completed',
      'Concrete cure/dry',
    ]),
    p('framing_roofing', 'Framing, Roofing & Exterior', [
      'Sill plate installed',
      'Floor framing installed',
      'Subfloor installed',
      'Wall framing first floor',
      'Wall framing second floor (if applicable)',
      'Roof framing (rafters/trusses)',
      'Sheathing installed (walls & roof)',
      'House wrap installed',
      'Roofing installed',
      'Windows installed',
      'Exterior doors installed',
      'Exterior siding installed',
      'Flashing installed at all transitions',
    ]),
    p('rough_in', 'Rough-In', [
      'Plumbing rough-in',
      'Electrical rough-in',
      'HVAC ductwork & equipment rough-in',
      'Gas line rough-in (if applicable)',
      'Inspections passed',
      'Insulation installed',
      'Vapor barrier installed',
    ]),
    p('interior', 'Drywall, Flooring & Interior Finishes', [
      'Drywall installed',
      'Drywall taped, mudded & sanded',
      'Primer applied',
      'Paint first coat',
      'Paint second coat',
      'Flooring installed',
      'Staircase installed (if applicable)',
      'Interior doors installed',
      'Trim & molding installed',
      'Touch-up painting',
    ]),
    p('doors_trim', 'Doors, Windows & Trim', [
      'Interior door hardware installed',
      'Window trim & sills completed',
      'Baseboard & crown molding installed',
      'Closet systems installed (if applicable)',
      'Built-ins installed (if applicable)',
      'Final caulking & sealing',
    ]),
    p('final', 'Final Inspection & CO', [
      'Site cleanup',
      'Debris removal',
      'All systems checked',
      'Structural connections verified',
      'Energy code compliance check',
      'Final walkthrough (internal)',
      'Punch list items fixed',
      'Final inspection scheduled',
      'Final inspection passed',
      'Certificate of Occupancy issued',
      'Project sign-off',
    ]),
  ],

  basement: [
    p('permit', 'Permit Application & Approval', [
      'Permit submitted',
      'Plan review in progress',
      'Revisions requested',
      'Plans resubmitted',
      'Permit approved',
      'Permit fees paid',
      'Permit issued',
      'Egress window requirements confirmed',
      'Inspection schedule defined',
    ]),
    p('waterproofing', 'Waterproofing & Structural Work', [
      'Existing conditions assessed',
      'Utilities located',
      'Waterproofing method defined',
      'Crack repair completed',
      'Waterproofing membrane applied',
      'Drainage system installed',
      'Sump pump installed/verified',
      'Egress window installed (if required)',
      'Window well installed',
      'Structural repairs completed',
      'Concrete floor prepped',
    ]),
    p('framing', 'Framing & Insulation', [
      'Layout planned & marked',
      'Sill plate moisture barrier installed',
      'Perimeter walls framed',
      'Interior partition walls framed',
      'Ceiling framing',
      'Egress window framing verified',
      'Insulation installed',
      'Vapor barrier installed',
      'Fire blocking installed',
    ]),
    p('rough_in', 'Rough-In', [
      'Electrical rough-in',
      'Plumbing rough-in (if bathroom)',
      'HVAC rough-in',
      'Inspections passed',
      'Low-voltage wiring',
    ]),
    p('drywall_floor', 'Drywall, Flooring & Painting', [
      'Drywall installed',
      'Drywall taped, mudded & sanded',
      'Primer applied',
      'Paint first coat',
      'Paint second coat',
      'Subfloor installed (if applicable)',
      'Flooring installed',
      'Drop ceiling installed (if applicable)',
      'Bathroom tile installed (if applicable)',
    ]),
    p('doors_trim', 'Doors, Trim & Final Touches', [
      'Interior doors installed',
      'Door hardware installed',
      'Baseboard & trim installed',
      'Bathroom fixtures installed (if applicable)',
      'Electrical fixtures installed',
      'HVAC registers & grilles installed',
      'Wet bar or kitchenette installed (if applicable)',
      'Final caulking & touch-ups',
    ]),
    p('final', 'Final Inspection & CO', [
      'Site cleanup',
      'Debris removal',
      'All systems function check',
      'Egress & safety check',
      'Smoke & CO detector installed & tested',
      'Code compliance check',
      'Final walkthrough (internal)',
      'Punch list items fixed',
      'Final inspection scheduled',
      'Final inspection passed',
      'Certificate of Occupancy issued',
      'Project sign-off',
    ]),
  ],

  driveway: [
    p('permit', 'Permit Application (if required)', [
      'Permit need assessment',
      'Permit submitted (if required)',
      'Plan review in progress',
      'Permit approved',
      'Permit fees paid',
      'Permit issued',
      'HOA approval obtained (if applicable)',
      'Inspection schedule defined',
    ]),
    p('excavation', 'Excavation & Grading', [
      'Site preparation',
      'Utilities located (811 check)',
      'Layout marked & staked',
      'Existing driveway demo & removal',
      'Excavation to proper depth',
      'Soil compaction tested',
      'Grading & slope established',
      'Debris removal & disposal',
    ]),
    p('base', 'Base Layer', [
      'Geotextile fabric installed (if applicable)',
      'Gravel base layer 1 installed',
      'Gravel base layer 1 compacted',
      'Gravel base layer 2 installed',
      'Gravel base layer 2 compacted',
      'Base depth verified',
      'Final compaction check',
      'Edge forms installed',
    ]),
    p('surface', 'Surface Installation', [
      'Forms set (concrete) / Sand bedding (pavers) / Binder course (asphalt)',
      'Reinforcement installed (rebar/mesh if concrete)',
      'Surface material installed',
      'Surface compacted/finished',
      'Control joints cut (if concrete)',
      'Curing compound applied (if concrete)',
      'Edge restraints installed (if pavers)',
      'Polymeric sand swept (if pavers)',
    ]),
    p('edging', 'Edging, Drainage & Cleanup', [
      'Apron/transition at street completed',
      'Curb cut (if applicable)',
      'Drainage channels installed',
      'Catch basins installed (if applicable)',
      'Edging & borders finalized',
      'Surrounding area restored',
      'Site cleanup',
      'Debris removal',
    ]),
    p('final', 'Final Inspection & Client Walkthrough', [
      'Surface condition check',
      'Slope & drainage verified (water test)',
      'Edge detail check',
      'Crack or void inspection',
      'Final walkthrough (internal)',
      'Punch list items fixed',
      'Client walkthrough',
      'Client sign-off',
      'Project sign-off',
    ]),
  ],
};

export const SERVICE_LABELS = {
  deck: 'Deck',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  addition: 'Addition',
  basement: 'Basement',
  driveway: 'Driveway',
};

// Normalize a free-form service string to a template key.
export function normalizeService(service) {
  if (!service) return null;
  const s = String(service).toLowerCase();
  if (s.includes('deck')) return 'deck';
  if (s.includes('kitchen')) return 'kitchen';
  if (s.includes('bathroom') || s.includes('bath')) return 'bathroom';
  if (s.includes('addition')) return 'addition';
  if (s.includes('basement')) return 'basement';
  if (s.includes('driveway') || s.includes('paver')) return 'driveway';
  return null;
}

// Returns a deep-cloned template for the given service, or null.
export function templateFor(service) {
  const key = normalizeService(service);
  if (!key) return null;
  return JSON.parse(JSON.stringify(PHASE_TEMPLATES[key]));
}

// Given phase_data, compute { totalDone, totalItems, progress, currentPhaseName }.
export function progressFromPhaseData(phaseData) {
  const phases = phaseData?.phases || [];
  let totalItems = 0;
  let totalDone = 0;
  let currentPhaseName = null;
  for (const ph of phases) {
    const items = ph.items || [];
    totalItems += items.length;
    totalDone += items.filter((i) => i.done).length;
    if (!currentPhaseName && items.some((i) => !i.done)) currentPhaseName = ph.name;
  }
  if (!currentPhaseName && phases.length > 0) currentPhaseName = phases[phases.length - 1].name;
  const progress = totalItems === 0 ? 0 : Math.round((totalDone / totalItems) * 100);
  return { totalDone, totalItems, progress, currentPhaseName };
}

// Pipeline status → label used to display "step phase atual".
export const PIPELINE_STEP_LABEL = {
  new_lead:          'Review Estimate',
  estimate_sent:     'Estimate Sent',
  estimate_approved: 'Estimate Approved',
  contract_sent:     'Contract Sent',
  contract_signed:   'Contract Signed',
  in_progress:       'In Progress',
  completed:         'Completed',
  on_hold:           'On Hold',
};
