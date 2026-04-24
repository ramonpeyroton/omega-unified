// Shared catalog values used by both NewLead and the EditLead modal in
// LeadsList. Keep the arrays in one place so they never drift apart.

// All 169 Connecticut municipalities, alphabetical.
export const CITIES = [
  'Andover', 'Ansonia', 'Ashford', 'Avon', 'Barkhamsted', 'Beacon Falls',
  'Berlin', 'Bethany', 'Bethel', 'Bethlehem', 'Bloomfield', 'Bolton',
  'Bozrah', 'Branford', 'Bridgeport', 'Bridgewater', 'Bristol', 'Brookfield',
  'Brooklyn', 'Burlington', 'Canaan', 'Canterbury', 'Canton', 'Chaplin',
  'Cheshire', 'Chester', 'Clinton', 'Colchester', 'Colebrook', 'Columbia',
  'Cornwall', 'Coventry', 'Cromwell', 'Danbury', 'Darien', 'Deep River',
  'Derby', 'Durham', 'East Granby', 'East Haddam', 'East Hampton',
  'East Hartford', 'East Haven', 'East Lyme', 'East Windsor', 'Eastford',
  'Easton', 'Ellington', 'Enfield', 'Essex', 'Fairfield', 'Farmington',
  'Franklin', 'Glastonbury', 'Goshen', 'Granby', 'Greenwich', 'Griswold',
  'Groton', 'Guilford', 'Haddam', 'Hamden', 'Hampton', 'Hartford',
  'Hartland', 'Harwinton', 'Hebron', 'Kent', 'Killingly', 'Killingworth',
  'Lebanon', 'Ledyard', 'Lisbon', 'Litchfield', 'Lyme', 'Madison',
  'Manchester', 'Mansfield', 'Marlborough', 'Meriden', 'Middlebury',
  'Middlefield', 'Middletown', 'Milford', 'Monroe', 'Montville', 'Morris',
  'Naugatuck', 'New Britain', 'New Canaan', 'New Fairfield', 'New Hartford',
  'New Haven', 'New London', 'New Milford', 'Newington', 'Newtown',
  'Norfolk', 'North Branford', 'North Canaan', 'North Haven',
  'North Stonington', 'Norwalk', 'Norwich', 'Old Lyme', 'Old Saybrook',
  'Orange', 'Oxford', 'Plainfield', 'Plainville', 'Plymouth', 'Pomfret',
  'Portland', 'Preston', 'Prospect', 'Putnam', 'Redding', 'Ridgefield',
  'Rocky Hill', 'Roxbury', 'Salem', 'Salisbury', 'Scotland', 'Seymour',
  'Sharon', 'Shelton', 'Sherman', 'Simsbury', 'Somers', 'South Windsor',
  'Southbury', 'Southington', 'Sprague', 'Stafford', 'Stamford', 'Sterling',
  'Stonington', 'Stratford', 'Suffield', 'Thomaston', 'Thompson', 'Tolland',
  'Torrington', 'Trumbull', 'Union', 'Vernon', 'Voluntown', 'Wallingford',
  'Warren', 'Washington', 'Waterbury', 'Waterford', 'Watertown',
  'West Hartford', 'West Haven', 'Westbrook', 'Weston', 'Westport',
  'Wethersfield', 'Willington', 'Wilton', 'Winchester', 'Windham',
  'Windsor', 'Windsor Locks', 'Wolcott', 'Woodbridge', 'Woodbury',
  'Woodstock', 'Other',
];

export const SERVICES = [
  { value: 'bathroom',       label: 'Bathroom Renovation' },
  { value: 'kitchen',        label: 'Kitchen Renovation'  },
  { value: 'addition',       label: 'Home Addition'       },
  { value: 'deck',           label: 'Deck / Patio'        },
  { value: 'roofing',        label: 'Roofing'             },
  { value: 'driveway',       label: 'Driveway'            },
  { value: 'basement',       label: 'Basement Finishing'  },
  { value: 'flooring',       label: 'Flooring'            },
  { value: 'survey',         label: 'Survey'              },
  { value: 'building_plans', label: 'Building Plans'      },
  { value: 'fullreno',       label: 'Full Renovation'     },
  { value: 'newconstruction',label: 'New Construction'    },
];

export const LEAD_SOURCES = [
  'Google', 'Referral', 'HomeAdvisor', 'Angie\'s List',
  'Door to Door', 'Social Media', 'Repeat Client', 'Drove By', 'Other',
];

export const PIPELINE_STATUSES = [
  { value: 'new_lead',             label: 'New Lead' },
  { value: 'estimate_draft',       label: 'Estimate — Draft' },
  { value: 'estimate_sent',        label: 'Estimate — Sent' },
  { value: 'estimate_negotiating', label: 'Estimate — Negotiating' },
  { value: 'estimate_approved',    label: 'Estimate — Approved' },
  { value: 'estimate_rejected',    label: 'Estimate — Rejected (LOST)' },
  { value: 'contract_sent',        label: 'Contract — Sent' },
  { value: 'contract_signed',      label: 'Contract — Signed' },
  { value: 'in_progress',          label: 'In Progress' },
  { value: 'completed',            label: 'Completed' },
];

export function serviceLabel(v) {
  return SERVICES.find((s) => s.value === v)?.label || v;
}
