// Shared catalog values used by both NewLead and the EditLead modal in
// LeadsList. Keep the arrays in one place so they never drift apart.

// States Omega serves. Connecticut is home base; New York and New
// Jersey were added once we started taking calls from across the
// state lines (Westchester, Bergen, etc.).
export const STATES = [
  { code: 'CT', name: 'Connecticut' },
  { code: 'NY', name: 'New York' },
  { code: 'NJ', name: 'New Jersey' },
];

// All 169 Connecticut municipalities, alphabetical. Kept under a CT
// key so the form can pick a city list per state.
const CITIES_CT = [
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
  'Southbury', 'Southington', 'Southport', 'Sprague', 'Stafford', 'Stamford', 'Sterling',
  'Stonington', 'Stratford', 'Suffield', 'Thomaston', 'Thompson', 'Tolland',
  'Torrington', 'Trumbull', 'Union', 'Vernon', 'Voluntown', 'Wallingford',
  'Warren', 'Washington', 'Waterbury', 'Waterford', 'Watertown',
  'West Hartford', 'West Haven', 'Westbrook', 'Weston', 'Westport',
  'Wethersfield', 'Willington', 'Wilton', 'Winchester', 'Windham',
  'Windsor', 'Windsor Locks', 'Wolcott', 'Woodbridge', 'Woodbury',
  'Woodstock',
];

// New York — focused list of municipalities most likely for Omega's
// reach (NYC boroughs + Westchester + Putnam + nearby Hudson Valley
// + Long Island towns the team already takes calls from). "Other"
// at the end lets the receptionist still type in something exotic.
const CITIES_NY = [
  // NYC boroughs
  'Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island',
  // Westchester County
  'Ardsley', 'Armonk', 'Bedford', 'Bronxville', 'Chappaqua', 'Cortlandt',
  'Croton-on-Hudson', 'Dobbs Ferry', 'Eastchester', 'Elmsford', 'Greenburgh',
  'Harrison', 'Hartsdale', 'Hastings-on-Hudson', 'Irvington', 'Larchmont',
  'Mamaroneck', 'Mount Kisco', 'Mount Pleasant', 'Mount Vernon', 'New Rochelle',
  'North Castle', 'Ossining', 'Peekskill', 'Pelham', 'Pleasantville',
  'Port Chester', 'Pound Ridge', 'Purchase', 'Rye', 'Rye Brook', 'Scarsdale',
  'Sleepy Hollow', 'Somers', 'Tarrytown', 'Tuckahoe', 'Valhalla', 'White Plains',
  'Yonkers', 'Yorktown',
  // Putnam County
  'Brewster', 'Carmel', 'Cold Spring', 'Mahopac', 'Patterson', 'Putnam Valley',
  // Rockland / Orange / Dutchess (close enough)
  'Beacon', 'Fishkill', 'Goshen', 'Middletown', 'Monroe', 'New City',
  'Newburgh', 'Nyack', 'Pearl River', 'Poughkeepsie', 'Suffern',
  // Long Island (Nassau / Suffolk core)
  'Garden City', 'Glen Cove', 'Great Neck', 'Hempstead', 'Hicksville',
  'Huntington', 'Long Beach', 'Manhasset', 'Massapequa', 'Mineola',
  'Oyster Bay', 'Port Washington', 'Rockville Centre', 'Smithtown',
  'Syosset',
];

// New Jersey — focused on Bergen + Hudson + Essex + Passaic (nearest
// to Omega's home turf) plus the major shore/central towns the team
// has fielded calls from.
const CITIES_NJ = [
  // Bergen County
  'Bergenfield', 'Cliffside Park', 'Closter', 'Cresskill', 'Demarest',
  'Dumont', 'East Rutherford', 'Edgewater', 'Elmwood Park', 'Englewood',
  'Englewood Cliffs', 'Fair Lawn', 'Fort Lee', 'Franklin Lakes', 'Garfield',
  'Glen Rock', 'Hackensack', 'Hasbrouck Heights', 'Leonia', 'Little Ferry',
  'Lodi', 'Lyndhurst', 'Mahwah', 'Maywood', 'Montvale', 'New Milford',
  'North Arlington', 'Norwood', 'Oakland', 'Oradell', 'Palisades Park',
  'Paramus', 'Park Ridge', 'Ramsey', 'Ridgefield', 'Ridgefield Park',
  'Ridgewood', 'River Edge', 'River Vale', 'Rutherford', 'Saddle Brook',
  'Tenafly', 'Teaneck', 'Wallington', 'Westwood', 'Woodcliff Lake',
  'Wyckoff',
  // Hudson County
  'Bayonne', 'Hoboken', 'Jersey City', 'Kearny', 'North Bergen',
  'Secaucus', 'Union City', 'Weehawken', 'West New York',
  // Essex County
  'Belleville', 'Bloomfield', 'Caldwell', 'Cedar Grove', 'East Orange',
  'Glen Ridge', 'Irvington', 'Livingston', 'Maplewood', 'Millburn',
  'Montclair', 'Newark', 'Nutley', 'Orange', 'Roseland', 'South Orange',
  'Verona', 'West Caldwell', 'West Orange',
  // Passaic / Morris / Union (close)
  'Clifton', 'Elizabeth', 'Linden', 'Morristown', 'Parsippany', 'Passaic',
  'Paterson', 'Plainfield', 'Summit', 'Wayne',
];

export const CITIES_BY_STATE = {
  CT: CITIES_CT,
  NY: CITIES_NY,
  NJ: CITIES_NJ,
};

// Backwards-compatible flat list used by older code paths that don't
// yet thread the state through. Kept = CT only (it's been "the city
// list" since day one) so legacy LeadsList edit row keeps showing the
// CT options. New screens should consume CITIES_BY_STATE directly.
export const CITIES = [...CITIES_CT, 'Other'];

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
  { value: 'partialreno',    label: 'Partial Renovation'  },
  { value: 'fullreno',       label: 'Full Renovation'     },
  { value: 'newconstruction',label: 'New Construction'    },
];

// Marketing channels offered for NEW leads (Lead Central, migration 077).
// The website intake writes 'Website', 'Google Ads', 'Houzz' and
// 'Local Services' straight into jobs.lead_source — keep those spellings.
export const LEAD_SOURCES = [
  'Houzz',
  'Local Services',
  'Google Ads',
  'Website',
  'Called In',
  'Referral',
  'Repeat Client',
  'Drove By',
  'Other',
];

// Retired channels. Leads that already carry one keep it — it still
// displays, filters and survives an edit — but it's no longer offered
// when creating a lead.
export const LEGACY_LEAD_SOURCES = [
  'Angi',
  'HomeAdvisor',
  'Mr.NailEdit',
  'Google',
  'Door to Door',
  'Social Media',
];

export const ALL_LEAD_SOURCES = [...LEAD_SOURCES, ...LEGACY_LEAD_SOURCES];

// Options for an edit <select>: the current list plus the lead's own
// value when it's legacy / free text, so saving the form never wipes it.
export function leadSourceOptions(current) {
  const v = (current || '').trim();
  return v && !LEAD_SOURCES.includes(v) ? [...LEAD_SOURCES, v] : LEAD_SOURCES;
}

// "Open in Google" link for leads that arrived with a source URL (website /
// Local Services / Houzz intake). Only http(s) URLs become links.
export function leadSourceLink(url) {
  const raw = (url || '').trim();
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const label = host.includes('houzz') ? 'Open in Houzz'
    : host.includes('google') || host === 'goo.gl' ? 'Open in Google'
    : 'Open lead source';
  return { href: u.href, label };
}

export const PIPELINE_STATUSES = [
  { value: 'new_lead',             label: 'New Lead' },
  { value: 'contacted',            label: 'Contacted' },
  { value: 'visit_scheduled',      label: 'Visit Scheduled' },
  { value: 'visited',              label: 'Visited' },
  { value: 'estimate_draft',       label: 'Estimate — Draft' },
  { value: 'estimate_sent',        label: 'Estimate — Sent' },
  { value: 'estimate_negotiating', label: 'Estimate — Negotiating' },
  { value: 'estimate_approved',    label: 'Estimate — Approved' },
  { value: 'contract_sent',        label: 'Contract — Sent' },
  { value: 'contract_signed',      label: 'Contract — Signed' },
  { value: 'in_progress',          label: 'In Progress' },
  { value: 'completed',            label: 'Completed' },
  { value: 'estimate_rejected',    label: 'Lost' },
];

// Why a job went to Lost. Values match jobs_lost_reason_check (077).
// 'estimate_rejected' is also what the DB fills in when a job lands in
// Lost without a reason (e.g. the Estimate Flow "Reject" button).
export const LOST_REASONS = [
  { value: 'no_response',          label: 'No response' },
  { value: 'not_a_fit',            label: 'Not a fit' },
  { value: 'price',                label: 'Price' },
  { value: 'went_with_competitor', label: 'Went with another contractor' },
  { value: 'out_of_area',          label: 'Out of area' },
  { value: 'estimate_rejected',    label: 'Estimate rejected' },
  { value: 'other',                label: 'Other' },
];

export function lostReasonLabel(v) {
  return LOST_REASONS.find((r) => r.value === v)?.label || null;
}

export function serviceLabel(v) {
  return SERVICES.find((s) => s.value === v)?.label || v;
}

// ─── Lead Status (Rafaela's old day-to-day tag) ──────────────────
//
// HIDDEN from the UI since Lead Central (077) — the pipeline stages
// (Contacted, Visit Scheduled, …) replaced it. jobs.lead_status and its
// CHECK constraint (035) stay in the DB; the list is kept so Import Leads
// can still map a spreadsheet's STATUS column into it.
export const LEAD_STATUSES = [
  { value: 'appointment_set', label: 'Appointment Set', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'follow_up',       label: 'Follow Up',       cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'estimate_sent',   label: 'Estimate Sent',   cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  { value: 'signed',          label: 'Signed',          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { value: 'declined',        label: 'Declined',        cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'lost',            label: 'Lost',            cls: 'bg-red-100 text-red-700 border-red-200' },
];

