export const PHASE_TEMPLATES = {
  bathroom: [
    {
      phase: 'Site Protection & Demo Prep',
      tasks: [
        'Cover floors with protective boards or rosin paper',
        'Seal doorways with plastic dust containment barrier',
        'Locate and confirm water shutoff location',
        'Locate and confirm electrical panel — identify circuit',
        'Take before photos of all areas',
      ],
    },
    {
      phase: 'Demolition',
      tasks: [
        'Confirm water is OFF before starting demo',
        'Confirm no live electrical in demo area',
        'Confirm dumpster is in place',
        'Demo tile flooring, wall tile, and drywall',
        'Remove existing fixtures (vanity, toilet, tub/shower)',
        'Inspect subfloor for rot or soft spots',
        'STOP and notify owner immediately if mold is found',
        'Haul all debris',
      ],
    },
    {
      phase: 'Rough Plumbing',
      tasks: [
        'Permit required — confirm permit is posted on site',
        'Licensed plumber only for this phase',
        'Rough in drain lines per approved plan',
        'Rough in supply lines (hot and cold)',
        'Pressure test all lines',
        'Schedule rough plumbing inspection',
        'Do NOT close walls until inspection passes',
      ],
    },
    {
      phase: 'Rough Electrical',
      tasks: [
        'Permit required — confirm permit is posted on site',
        'Licensed electrician only for this phase',
        'GFCI protection required in bathrooms per CT code',
        'Run circuits and install junction boxes',
        'Exhaust fan rough-in',
        'Schedule rough electrical inspection',
        'Do NOT close walls until inspection passes',
      ],
    },
    {
      phase: 'Waterproofing',
      tasks: [
        'Critical step — do not skip or rush',
        'Apply RedGard or Schluter waterproofing system per manufacturer spec',
        'Inspect all corners and seams — apply double layer at corners',
        'Check floor drain waterproofing',
        'Allow 24–48 hour cure time before tiling',
        'Photo all waterproofing before covering',
      ],
    },
    {
      phase: 'Tile Work',
      tasks: [
        'Confirm waterproofing is fully cured',
        'Check floor level — use self-leveler if needed',
        'Set floor tile per approved pattern',
        'Set wall tile and shower tile',
        'Allow 24 hours before grouting',
        'Apply grout and seal all grout lines',
      ],
    },
    {
      phase: 'Fixtures & Finish',
      tasks: [
        'Install drywall in non-wet areas, tape and mud',
        'Prime and paint walls and ceiling',
        'Install vanity and countertop',
        'Install toilet',
        'Install shower/tub fixtures and trim',
        'Caulk all penetrations and transitions',
        'Test all valves and supply lines for leaks',
      ],
    },
    {
      phase: 'Final Walkthrough',
      tasks: [
        'Complete punch list review',
        'Confirm all tile grout and caulk is finished',
        'Test all fixtures and confirm water flow',
        'Confirm GFCI outlets are functioning',
        'Clean all surfaces and fixtures',
        'Walk through with client and get sign-off',
      ],
    },
  ],

  kitchen: [
    {
      phase: 'Site Protection & Demo Prep',
      tasks: [
        'Cover and protect floors in work area and adjacent rooms',
        'Protect adjacent rooms with dust containment barriers',
        'Locate water, gas, and electrical shutoffs',
        'Disconnect appliances and remove from space',
        'Take before photos of all areas',
      ],
    },
    {
      phase: 'Demolition',
      tasks: [
        'Confirm water, gas, and electrical are OFF',
        'Remove cabinets carefully — salvage if specified',
        'Remove countertops',
        'Demo flooring',
        'Demo walls if open concept planned',
        'Inspect subfloor for rot or damage',
        'Check for mold — STOP and notify owner if found',
        'Haul all debris',
      ],
    },
    {
      phase: 'Rough Plumbing',
      tasks: [
        'Permit required — confirm permit posted',
        'Relocate supply and drain lines if layout changed',
        'Rough in for dishwasher and garbage disposal',
        'Pressure test all lines',
        'Schedule rough plumbing inspection',
      ],
    },
    {
      phase: 'Rough Electrical',
      tasks: [
        'Permit required — confirm permit posted',
        'Run dedicated circuits for appliances (refrigerator, dishwasher, microwave, range)',
        'AFCI protection required per CT code 2022',
        'Under-cabinet lighting rough-in',
        'Schedule rough electrical inspection',
      ],
    },
    {
      phase: 'Framing & Drywall',
      tasks: [
        'Frame new walls if open concept or layout change',
        'Install moisture-resistant drywall near sink area',
        'Tape, mud, and sand drywall',
        'Prime all drywall surfaces',
      ],
    },
    {
      phase: 'Cabinet Installation',
      tasks: [
        'Install upper cabinets first',
        'Install base cabinets — shim and level all cabinets',
        'Secure all cabinets to wall studs',
        'Install island or peninsula if applicable',
        'Install cabinet hardware',
      ],
    },
    {
      phase: 'Countertop & Backsplash',
      tasks: [
        'Template countertops after cabinet install',
        'Confirm sink cutout dimensions',
        'Install countertops',
        'Install backsplash tile',
        'Grout and seal backsplash',
      ],
    },
    {
      phase: 'Appliances & Fixtures',
      tasks: [
        'Install sink and faucet',
        'Connect dishwasher plumbing and electrical',
        'Install garbage disposal',
        'Install range, refrigerator, microwave/hood',
        'Test all appliances and plumbing connections',
      ],
    },
    {
      phase: 'Final Walkthrough',
      tasks: [
        'Complete punch list review with client',
        'Test all appliances and confirm operation',
        'Confirm all plumbing connections are leak-free',
        'Clean all surfaces and cabinets',
        'Walk through with client and get sign-off',
      ],
    },
  ],

  addition: [
    {
      phase: 'Site Prep & Layout',
      tasks: [
        'Confirm setbacks and zoning with town building department',
        'Call 811 to mark underground utilities',
        'Layout building footprint with batter boards and string',
        'Set up staging area and site access',
        'Install erosion controls',
      ],
    },
    {
      phase: 'Excavation & Footings',
      tasks: [
        'Excavate to 48-inch frost depth minimum (CT requirement)',
        'Form and pour concrete footings',
        'Schedule footing inspection before pouring foundation',
        'Confirm footing inspection passes',
      ],
    },
    {
      phase: 'Foundation',
      tasks: [
        'Pour foundation walls or slab',
        'Apply waterproofing to exterior foundation walls',
        'Install drainage board and drain tile',
        'Backfill after waterproofing is inspected',
      ],
    },
    {
      phase: 'Framing',
      tasks: [
        'Install sill plate with anchor bolts',
        'Frame floor system',
        'Frame exterior walls and interior partitions',
        'Install window and door headers',
        'Roof framing — confirm pitch matches existing structure',
        'Install roof sheathing',
        'Install wall sheathing and house wrap',
      ],
    },
    {
      phase: 'Roofing',
      tasks: [
        'Install full ice and water shield (CT requirement)',
        'Install roofing underlayment',
        'Install roofing material to match existing',
        'Install all flashing at transitions, walls, and valleys',
        'Inspect for gaps or exposed areas',
      ],
    },
    {
      phase: 'Rough Plumbing',
      tasks: [
        'Rough in drain and supply lines if addition includes bath or kitchen',
        'Pressure test all lines',
        'Schedule rough plumbing inspection',
      ],
    },
    {
      phase: 'Rough Electrical',
      tasks: [
        'Check panel capacity — upgrade if needed',
        'Run all circuit rough-in',
        'Low voltage rough-in if applicable',
        'Schedule rough electrical inspection',
      ],
    },
    {
      phase: 'Insulation',
      tasks: [
        'Install wall insulation per CT energy code',
        'Install ceiling insulation',
        'Install vapor barrier',
        'Air seal all penetrations',
      ],
    },
    {
      phase: 'Drywall',
      tasks: [
        'Hang drywall on walls and ceiling',
        'Tape, mud, and sand — three coats',
        'Prime all drywall',
      ],
    },
    {
      phase: 'Flooring',
      tasks: [
        'Install finish flooring to match or upgrade existing',
        'Install transitions at thresholds',
      ],
    },
    {
      phase: 'Paint & Trim',
      tasks: [
        'Prime and paint walls and ceiling',
        'Install baseboard and door trim',
        'Install doors and hardware',
        'Touch-up all paint',
      ],
    },
    {
      phase: 'Final Inspections & Punch List',
      tasks: [
        'Schedule final building inspection',
        'Schedule final electrical inspection',
        'Schedule final plumbing inspection if applicable',
        'Complete all punch list items',
        'Client walkthrough and sign-off',
      ],
    },
  ],

  deck: [
    {
      phase: 'Site Prep & Layout',
      tasks: [
        'Confirm setbacks with town — deck permit required',
        'Call 811 to mark underground utilities',
        'Layout post hole locations',
        'Set up staging area',
      ],
    },
    {
      phase: 'Footings',
      tasks: [
        'Dig post holes to 48-inch minimum depth (CT frost depth)',
        'Install Sonotube forms',
        'Pour concrete footings',
        'Schedule footing inspection before pouring',
        'Wait minimum 24 hours for concrete cure before loading',
      ],
    },
    {
      phase: 'Framing',
      tasks: [
        'Install post bases after concrete is cured',
        'Set and plumb posts',
        'Install beam on posts',
        'Attach ledger to house with proper flashing and lag bolts',
        'Install joists with joist hangers at proper spacing',
        'Install blocking',
      ],
    },
    {
      phase: 'Decking',
      tasks: [
        'Install decking boards — leave proper expansion gaps',
        'Use stainless steel or coated screws',
        'Trim boards flush at edges',
        'Check for any soft or damaged boards',
      ],
    },
    {
      phase: 'Railings & Stairs',
      tasks: [
        '42-inch guard height required if deck is over 30 inches above grade',
        'Maximum 4-inch baluster spacing',
        'Stair handrail required on one side minimum',
        'Install stair stringers and treads',
        'Confirm all railing connections are structural',
      ],
    },
    {
      phase: 'Electrical (if applicable)',
      tasks: [
        'Install GFCI outdoor outlets',
        'Install low voltage deck lighting',
        'Confirm all exterior-rated fixtures and covers',
      ],
    },
    {
      phase: 'Final Inspection & Punch List',
      tasks: [
        'Schedule final deck inspection',
        'Confirm all fasteners are driven and flush',
        'Clean deck surface',
        'Client walkthrough and sign-off',
      ],
    },
  ],

  basement: [
    {
      phase: 'Site Protection & Assessment',
      tasks: [
        'Check for active moisture intrusion — STOP if water is present',
        'Test for radon if not previously tested',
        'Protect upstairs floors and common areas',
        'Take before photos of all areas',
        'Identify location of mechanicals — confirm clearances',
      ],
    },
    {
      phase: 'Waterproofing (if needed)',
      tasks: [
        'Apply interior waterproofing system if moisture detected',
        'Install or verify sump pump operation',
        'Install sump pit if not present',
        'Test sump pump with water',
      ],
    },
    {
      phase: 'Framing',
      tasks: [
        'Use pressure-treated lumber for bottom plate on concrete',
        'Frame perimeter walls — maintain clearance from foundation',
        'Frame partition walls',
        'Build soffit boxing for mechanicals',
        'Install blocking for future TV mounts and grab bars',
      ],
    },
    {
      phase: 'Rough Electrical',
      tasks: [
        'Run dedicated circuits as required',
        'AFCI protection required throughout per CT code 2022',
        'Recessed lighting rough-in',
        'Panel work if additional circuits needed',
        'Schedule rough electrical inspection',
      ],
    },
    {
      phase: 'Rough Plumbing (if applicable)',
      tasks: [
        'Permit required for bathroom or wet bar',
        'Core drill through slab if needed',
        'Rough in drain lines',
        'Rough in supply lines',
        'Schedule rough plumbing inspection',
      ],
    },
    {
      phase: 'Insulation',
      tasks: [
        'Install rigid foam insulation on concrete walls — do NOT use fiberglass against concrete',
        'Install vapor barrier on floor if not using rigid foam floor system',
        'Insulate rim joists',
        'Air seal all penetrations',
      ],
    },
    {
      phase: 'Drywall',
      tasks: [
        'Install moisture-resistant drywall throughout',
        'Hang drywall on walls and ceiling',
        'Tape, mud, and sand — three coats',
        'Prime all drywall',
      ],
    },
    {
      phase: 'Flooring',
      tasks: [
        'Test concrete moisture levels before flooring install',
        'LVP (Luxury Vinyl Plank) is recommended over concrete',
        'Install flooring per manufacturer spec',
        'Install transitions at stair landing',
      ],
    },
    {
      phase: 'Ceiling',
      tasks: [
        'Install drop ceiling grid or drywall ceiling',
        'Confirm access panels at all cleanouts and shutoffs',
        'Install recessed lights and diffusers',
      ],
    },
    {
      phase: 'Paint & Finish',
      tasks: [
        'Prime and paint all walls and ceiling',
        'Install baseboard and door trim',
        'Install interior doors and hardware',
        'Paint trim and doors',
      ],
    },
    {
      phase: 'Final Fixtures & Punch List',
      tasks: [
        'Install all electrical devices and covers',
        'Install all light fixtures',
        'Install bathroom fixtures if applicable',
        'Complete punch list',
        'Client walkthrough and sign-off',
      ],
    },
  ],

  roofing: [
    {
      phase: 'Site Protection',
      tasks: [
        'Protect all landscaping and shrubs with plywood or tarps',
        'Cover air conditioning units',
        'Cover windows and entry doors',
        'Position dumpster for debris',
        'Set up ladder and roof safety equipment',
      ],
    },
    {
      phase: 'Tear-Off',
      tasks: [
        'Remove existing shingles and underlayment',
        'Inspect decking for rot, soft spots, or damage',
        'Mark all damaged decking boards',
        'Remove all nails and staples from decking',
      ],
    },
    {
      phase: 'Sheathing Repair',
      tasks: [
        'Replace all damaged or rotten decking boards',
        'Nail off entire deck to current code (nailing pattern)',
        'Confirm deck is solid with no movement',
      ],
    },
    {
      phase: 'Underlayment & Ice Shield',
      tasks: [
        'Apply ice and water shield — full roof coverage recommended in CT',
        'Minimum 6-foot coverage from eave in CT',
        'Apply roofing underlayment over ice shield',
        'Install drip edge on eaves before underlayment, on rakes after',
      ],
    },
    {
      phase: 'Roofing Install',
      tasks: [
        'Install starter strip at eave',
        'Install shingles per manufacturer specs and exposure requirements',
        'Maintain proper nail pattern — 4 nails minimum per shingle',
        'Work up from eave to ridge',
        'Install ridge vent or ridge cap',
      ],
    },
    {
      phase: 'Flashing & Gutters',
      tasks: [
        'Install step flashing at all wall intersections',
        'Install counter flashing at chimney',
        'Install valley flashing',
        'Inspect all penetrations — pipe boots, skylights',
        'Clean or install gutters and downspouts',
      ],
    },
    {
      phase: 'Cleanup & Final',
      tasks: [
        'Remove all debris from roof and ground',
        'Magnet sweep entire yard for nails',
        'Inspect entire roof from ground',
        'Remove all protective coverings',
        'Client walkthrough and sign-off',
      ],
    },
  ],

  driveway: [
    {
      phase: 'Site Prep',
      tasks: [
        'Mark driveway edges and confirm layout with client',
        'Protect adjacent landscaping',
        'Confirm drainage plan — water must flow away from house',
      ],
    },
    {
      phase: 'Excavation',
      tasks: [
        'Remove existing material to proper depth',
        'Remove and dispose of old asphalt or concrete if replacing',
        'Confirm sub-base is solid with no soft spots',
      ],
    },
    {
      phase: 'Base Layer',
      tasks: [
        'Install and compact crushed stone base layer',
        'Check grade for proper drainage',
        'Compact in lifts — do not compact more than 4 inches at a time',
      ],
    },
    {
      phase: 'Surface Install',
      tasks: [
        'Pour or install final surface material',
        'Confirm proper thickness per material spec',
        'Check grade and drainage direction',
      ],
    },
    {
      phase: 'Edging & Finishing',
      tasks: [
        'Install edge restraints or curbing',
        'Final grading at edges',
        'Apply sealer if asphalt (after 30-day cure)',
      ],
    },
    {
      phase: 'Cleanup & Cure',
      tasks: [
        'Remove all equipment and debris',
        'Place curing barriers if concrete',
        'Inform client of cure time before vehicle use',
        'Client walkthrough and sign-off',
      ],
    },
  ],

  'full renovation': [
    {
      phase: 'Site Protection & Demo Prep',
      tasks: [
        'Cover all floors and protect adjacnt areas',
        'Seal all doorways with dust barriers',
        'Locate and label all shutoffs',
        'Take comprehensive before photos',
      ],
    },
    {
      phase: 'Demolition',
      tasks: [
        'Confirm all utilities OFF before demo',
        'Demo per approved scope',
        'Inspect for mold — STOP and notify owner if found',
        'Inspect subfloors and structure',
        'Haul all debris',
      ],
    },
    {
      phase: 'Rough Plumbing',
      tasks: [
        'Permit required',
        'Rough in all plumbing per plan',
        'Pressure test',
        'Schedule inspection — do NOT close walls until passed',
      ],
    },
    {
      phase: 'Rough Electrical',
      tasks: [
        'Permit required',
        'Run all circuits',
        'AFCI/GFCI per CT code',
        'Schedule inspection — do NOT close walls until passed',
      ],
    },
    {
      phase: 'Framing & Structure',
      tasks: [
        'Frame all new walls and openings',
        'Install headers for new openings',
        'Waterproofing for wet areas',
        'Inspect all framing',
      ],
    },
    {
      phase: 'Insulation & Drywall',
      tasks: [
        'Install insulation per CT energy code',
        'Hang drywall',
        'Tape, mud, sand — three coats',
        'Prime',
      ],
    },
    {
      phase: 'Tile & Flooring',
      tasks: [
        'Install tile in wet areas',
        'Grout and seal tile',
        'Install finish flooring',
      ],
    },
    {
      phase: 'Cabinets & Countertops',
      tasks: [
        'Install cabinets level and plumb',
        'Template and install countertops',
        'Install backsplash',
      ],
    },
    {
      phase: 'Paint & Trim',
      tasks: [
        'Prime and paint all rooms',
        'Install doors and hardware',
        'Install baseboard and trim',
        'Touch-up all paint',
      ],
    },
    {
      phase: 'Finish Plumbing & Electrical',
      tasks: [
        'Set all fixtures',
        'Install all devices and covers',
        'Install all light fixtures',
        'Test all systems',
      ],
    },
    {
      phase: 'Final Inspections & Punch List',
      tasks: [
        'Schedule all final inspections',
        'Complete punch list',
        'Client walkthrough and sign-off',
      ],
    },
  ],

  inspection: [
    {
      phase: 'Site Walkthrough — Exterior',
      tasks: [
        'Inspect roof from ground — note condition, age, any visible damage',
        'Inspect gutters and downspouts',
        'Inspect siding — note cracks, rot, paint failure',
        'Inspect windows — note condition, seal failure, rot',
        'Inspect foundation — note cracks, settlement, water staining',
        'Photo all findings with notes',
      ],
    },
    {
      phase: 'Interior Inspection',
      tasks: [
        'Inspect each room — walls, ceilings, floors, windows',
        'Inspect kitchen — cabinets, counters, appliances, plumbing',
        'Inspect each bathroom — tile, fixtures, ventilation',
        'Inspect basement — moisture, structural, mechanical systems',
        'Inspect attic if accessible — insulation, ventilation, structure',
        'Photo all findings with notes',
      ],
    },
    {
      phase: 'Documentation',
      tasks: [
        'Photo all findings with clear labels',
        'Note priority level: Immediate / 1-2 Year / Long Term',
        'Compile list of all items found',
      ],
    },
    {
      phase: 'Recommendations',
      tasks: [
        'List immediate safety or structural needs',
        'List 1–2 year recommended repairs',
        'List long-term upgrade opportunities',
        'Note any code compliance issues observed',
      ],
    },
    {
      phase: 'Proposal Presentation',
      tasks: [
        'Present all findings to owner',
        'Discuss priority and budget for each item',
        'Provide written proposal for recommended work',
        'Schedule follow-up if needed',
      ],
    },
  ],

  'new construction': [
    {
      phase: 'Site Prep & Clearing',
      tasks: ['Clear and grade site', 'Call 811 for utility markouts', 'Confirm setbacks and permits', 'Set up staging area and site access'],
    },
    {
      phase: 'Excavation & Footings',
      tasks: ['Excavate to 48-inch frost depth (CT minimum)', 'Form and pour footings', 'Schedule footing inspection'],
    },
    {
      phase: 'Foundation',
      tasks: ['Pour foundation walls', 'Waterproof exterior walls', 'Install drain tile', 'Backfill'],
    },
    {
      phase: 'Framing',
      tasks: ['Sill plate with anchor bolts', 'Floor framing', 'Wall framing', 'Roof framing', 'Roof and wall sheathing', 'House wrap'],
    },
    {
      phase: 'Roofing',
      tasks: ['Full ice and water shield', 'Underlayment', 'Roofing material', 'All flashing'],
    },
    {
      phase: 'Rough Plumbing',
      tasks: ['Drain rough-in', 'Supply rough-in', 'Pressure test', 'Schedule inspection'],
    },
    {
      phase: 'Rough Electrical',
      tasks: ['Panel installation', 'All circuit runs', 'Low voltage rough-in', 'Schedule inspection'],
    },
    {
      phase: 'HVAC Rough',
      tasks: ['Ductwork or mini-split refrigerant lines', 'Equipment placement', 'Thermostat wiring'],
    },
    {
      phase: 'Insulation',
      tasks: ['Wall insulation per CT energy code', 'Ceiling insulation', 'Vapor barrier', 'Air sealing'],
    },
    {
      phase: 'Drywall',
      tasks: ['Hang drywall', 'Tape, mud, sand — three coats', 'Prime'],
    },
    {
      phase: 'Flooring',
      tasks: ['Install finish flooring', 'Install tile in wet areas', 'Transitions'],
    },
    {
      phase: 'Cabinets & Fixtures',
      tasks: ['Install kitchen cabinets', 'Template and install countertops', 'Install bathroom vanities', 'Set plumbing fixtures'],
    },
    {
      phase: 'Paint & Trim',
      tasks: ['Prime and paint all rooms', 'Install all doors and hardware', 'Install trim and moldings'],
    },
    {
      phase: 'Final Inspections',
      tasks: ['Schedule all final inspections — building, electrical, plumbing, mechanical', 'Confirm certificate of occupancy process'],
    },
    {
      phase: 'Punch List & Handover',
      tasks: ['Complete all punch list items', 'Final cleaning', 'Client walkthrough and sign-off', 'Deliver all warranty documents and manuals'],
    },
  ],

  default: [
    { phase: 'Site Prep', tasks: ['Protect work area', 'Stage materials', 'Locate all shutoffs', 'Take before photos'] },
    { phase: 'Demo', tasks: ['Confirm utilities OFF', 'Remove existing materials', 'Inspect for hidden damage', 'Haul debris'] },
    { phase: 'Rough Work', tasks: ['Structural changes if needed', 'Mechanical rough-ins', 'Schedule inspections'] },
    { phase: 'Installation', tasks: ['Main installation work', 'Quality checks throughout'] },
    { phase: 'Finishes', tasks: ['Apply finishes', 'Paint', 'Install trim'] },
    { phase: 'Cleanup & Punch List', tasks: ['Remove all debris', 'Clean area', 'Complete punch list', 'Client walkthrough'] },
  ],
};

export function getPhasesForService(service) {
  const s = (service || '').toLowerCase();
  if (s.includes('bathroom') || s.includes('bath')) return PHASE_TEMPLATES.bathroom;
  if (s.includes('kitchen')) return PHASE_TEMPLATES.kitchen;
  if (s.includes('addition')) return PHASE_TEMPLATES.addition;
  if (s.includes('deck')) return PHASE_TEMPLATES.deck;
  if (s.includes('basement') || s.includes('refinish')) return PHASE_TEMPLATES.basement;
  if (s.includes('roof')) return PHASE_TEMPLATES.roofing;
  if (s.includes('driveway')) return PHASE_TEMPLATES.driveway;
  if (s.includes('full renovation') || s.includes('full reno')) return PHASE_TEMPLATES['full renovation'];
  if (s.includes('inspection') || s.includes('upsell')) return PHASE_TEMPLATES.inspection;
  if (s.includes('new construction') || s.includes('new build')) return PHASE_TEMPLATES['new construction'];
  return PHASE_TEMPLATES.default;
}
