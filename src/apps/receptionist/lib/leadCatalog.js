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

// Marketing channels Omega tracks for new leads. Order is
// alphabetical-ish but with high-volume sources surfaced first
// ("Google" / "Referral") so the receptionist hits the right one
// fastest in the dropdown.
export const LEAD_SOURCES = [
  'Google',
  'Referral',
  'Houzz',
  'HomeAdvisor',
  'Angi',          // formerly "Angie's List" — rebranded; kept this name only.
  'Mr.NailEdit',
  'Door to Door',
  'Social Media',
  'Repeat Client',
  'Drove By',
  'Other',
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
