// LeadsHeatMap — real CT map (CartoDB tiles) + blurred heat circles + numbered bubbles
// Requires: leaflet ^1.9.4 + react-leaflet ^4.2.1  (npm install leaflet react-leaflet)
import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup, Pane } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Fix Leaflet's broken default icon in Vite/Webpack ──────────────
// (Not needed since we use DivIcon only, but prevents console warnings)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── CT city coordinates [lat, lng] ─────────────────────────────────
const CITY_COORDS = {
  // ── Fairfield County ──────────────────────────────────────────────
  'greenwich':      [41.0262, -73.6282], 'cos cob':       [41.0407, -73.5990],
  'old greenwich':  [41.0329, -73.5665], 'riverside':     [41.0204, -73.5768],
  'glenville':      [41.0493, -73.6399],
  'stamford':       [41.0534, -73.5387], 'springdale':    [41.0768, -73.5332],
  'darien':         [41.0793, -73.4688], 'noroton':       [41.0682, -73.4682],
  'new canaan':     [41.1468, -73.4949],
  'norwalk':        [41.1177, -73.4079], 'east norwalk':  [41.1099, -73.3818],
  'wilton':         [41.1954, -73.4354],
  'westport':       [41.1415, -73.3579], 'saugatuck':     [41.1382, -73.3632],
  'weston':         [41.2015, -73.3779],
  'fairfield':      [41.1408, -73.2637], 'southport':     [41.1204, -73.2788],
  'bridgeport':     [41.1865, -73.1952], 'black rock':    [41.1754, -73.2218],
  'trumbull':       [41.2429, -73.2007],
  'monroe':         [41.3315, -73.2087],
  'shelton':        [41.3165, -73.0887],
  'stratford':      [41.1845, -73.1332],
  'milford':        [41.2265, -73.0568], 'devon':         [41.2382, -73.0793],
  'orange':         [41.2779, -73.0290],
  'derby':          [41.3265, -73.0854],
  'ansonia':        [41.3443, -73.0779],
  'seymour':        [41.3965, -73.0779],
  'bethel':         [41.3712, -73.4138],
  'brookfield':     [41.4715, -73.3898],
  'newtown':        [41.4137, -73.3032],
  'redding':        [41.3035, -73.3877],
  'easton':         [41.2512, -73.3054],
  'ridgefield':     [41.2812, -73.4987],
  'danbury':        [41.3948, -73.4540],
  'new fairfield':  [41.4704, -73.4832],
  'sherman':        [41.5918, -73.5238],
  // ── New Haven County ─────────────────────────────────────────────
  'new haven':      [41.3082, -72.9279],
  'west haven':     [41.2715, -72.9468],
  'east haven':     [41.2765, -72.8687],
  'hamden':         [41.3959, -72.8968],
  'north haven':    [41.3904, -72.8579],
  'waterbury':      [41.5582, -73.0515],
  'naugatuck':      [41.4890, -73.0513],
  'meriden':        [41.5382, -72.7968],
  'wallingford':    [41.4572, -72.8232],
  'cheshire':       [41.4990, -72.9012],
  'southbury':      [41.4807, -73.2143],
  'oxford':         [41.4332, -73.1165],
  'beacon falls':   [41.4415, -73.0582],
  'woodbridge':     [41.3415, -72.9984],
  'bethany':        [41.4379, -72.9943],
  'madison':        [41.2790, -72.5982],
  'guilford':       [41.2890, -72.6812],
  'branford':       [41.2790, -72.8149],
  'north branford': [41.3290, -72.7549],
  'wolcott':        [41.5993, -72.9832],
  'prospect':       [41.5015, -72.9782],
  // ── Hartford County ───────────────────────────────────────────────
  'hartford':       [41.7658, -72.6851],
  'west hartford':  [41.7623, -72.7421],
  'east hartford':  [41.7823, -72.6121],
  'new britain':    [41.6612, -72.7793],
  'bristol':        [41.6712, -72.9493],
  'southington':    [41.5990, -72.8779],
  'newington':      [41.6979, -72.7190],
  'glastonbury':    [41.7018, -72.6082],
  'enfield':        [41.9762, -72.5918],
  'bloomfield':     [41.8212, -72.7390],
  'manchester':     [41.7762, -72.5218],
  'plainville':     [41.6754, -72.8593],
  'canton':         [41.8276, -72.8932],
  'simsbury':       [41.8790, -72.8082],
  'avon':           [41.8082, -72.8332],
  'farmington':     [41.7126, -72.8332],
  'burlington':     [41.7693, -72.9659],
  'granby':         [41.9632, -72.8379],
  'suffield':       [41.9868, -72.6518],
  'windsor':        [41.8526, -72.6418],
  'windsor locks':  [41.9293, -72.6282],
  'south windsor':  [41.8340, -72.5985],
  'east windsor':   [41.9107, -72.5896],
  'wethersfield':   [41.7140, -72.6518],
  'rocky hill':     [41.6654, -72.6518],
  'berlin':         [41.6215, -72.7793],
  // ── Middlesex County ─────────────────────────────────────────────
  'middletown':     [41.5623, -72.6507],
  'old saybrook':   [41.2932, -72.3757],
  'clinton':        [41.2782, -72.5282],
  'westbrook':      [41.2921, -72.4490],
  'essex':          [41.3529, -72.3929],
  'deep river':     [41.3832, -72.4390],
  'chester':        [41.4032, -72.4499],
  'cromwell':       [41.5918, -72.6488],
  'portland':       [41.5782, -72.6282],
  'east haddam':    [41.4532, -72.3632],
  'haddam':         [41.4782, -72.5132],
  'durham':         [41.4882, -72.6782],
  // ── New London County ────────────────────────────────────────────
  'new london':     [41.3557, -72.0993],
  'norwich':        [41.5243, -72.0757],
  'groton':         [41.3507, -72.0732],
  'mystic':         [41.3543, -71.9668],
  'waterford':      [41.3582, -72.1388],
  'montville':      [41.4732, -72.1538],
  'colchester':     [41.5765, -72.3282],
  'east lyme':      [41.3682, -72.2188],
  'old lyme':       [41.3132, -72.3288],
  'ledyard':        [41.4407, -71.9943],
  'stonington':     [41.3351, -71.9107],
  'niantic':        [41.3271, -72.1938],
  // ── Litchfield County ────────────────────────────────────────────
  'torrington':     [41.8007, -73.1218],
  'new milford':    [41.5768, -73.4082],
  'litchfield':     [41.7504, -73.1882],
  'winsted':        [41.9263, -73.0618],
  'thomaston':      [41.6732, -73.0743],
  'harwinton':      [41.7732, -73.0593],
  'cornwall':       [41.8454, -73.3232],
  'kent':           [41.7254, -73.4782],
  'salisbury':      [41.9893, -73.4218],
  'sharon':         [41.8832, -73.4732],
  'woodbury':       [41.5454, -73.2082],
  'watertown':      [41.6040, -73.1182],
  // ── Tolland County ───────────────────────────────────────────────
  'stafford springs': [41.9654, -72.3082],
  'coventry':       [41.7679, -72.3532],
  'tolland':        [41.8679, -72.3682],
  'ellington':      [41.9082, -72.4618],
  'somers':         [42.0032, -72.4418],
  'andover':        [41.7329, -72.3882],
  'bolton':         [41.7679, -72.4282],
  'hebron':         [41.6579, -72.3682],
  'vernon':         [41.8407, -72.4618],
  'rockville':      [41.8568, -72.4502],
  // ── Windham County ───────────────────────────────────────────────
  'willimantic':    [41.7107, -72.2082],
  'putnam':         [41.9182, -71.9118],
  'plainfield':     [41.6782, -71.9232],
  'killingly':      [41.8407, -71.8618],
  'brooklyn':       [41.7854, -71.9482],
  'woodstock':      [41.9479, -72.0082],
  'ashford':        [41.8629, -72.1532],
  'eastford':       [41.8932, -72.0882],
};

// ─── City → County (for right-panel totals) ─────────────────────────
const CITY_TO_COUNTY = {
  'greenwich':'fairfield','cos cob':'fairfield','old greenwich':'fairfield',
  'byram':'fairfield','riverside':'fairfield','glenville':'fairfield',
  'stamford':'fairfield','springdale':'fairfield',
  'darien':'fairfield','noroton':'fairfield','noroton heights':'fairfield',
  'new canaan':'fairfield',
  'norwalk':'fairfield','east norwalk':'fairfield','south norwalk':'fairfield',
  'wilton':'fairfield','westport':'fairfield','saugatuck':'fairfield',
  'weston':'fairfield','fairfield':'fairfield','southport':'fairfield',
  'bridgeport':'fairfield','black rock':'fairfield',
  'trumbull':'fairfield','monroe':'fairfield','shelton':'fairfield',
  'stratford':'fairfield','milford':'fairfield','devon':'fairfield',
  'orange':'fairfield','derby':'fairfield','ansonia':'fairfield',
  'seymour':'fairfield','bethel':'fairfield','brookfield':'fairfield',
  'newtown':'fairfield','redding':'fairfield','easton':'fairfield',
  'new fairfield':'fairfield','sherman':'fairfield','ridgefield':'fairfield',
  'danbury':'fairfield',
  'new haven':'new_haven','west haven':'new_haven','east haven':'new_haven',
  'hamden':'new_haven','north haven':'new_haven','waterbury':'new_haven',
  'naugatuck':'new_haven','meriden':'new_haven','wallingford':'new_haven',
  'cheshire':'new_haven','southbury':'new_haven','oxford':'new_haven',
  'beacon falls':'new_haven','woodbridge':'new_haven','bethany':'new_haven',
  'madison':'new_haven','guilford':'new_haven','branford':'new_haven',
  'north branford':'new_haven','wolcott':'new_haven','prospect':'new_haven',
  'hartford':'hartford','west hartford':'hartford','east hartford':'hartford',
  'new britain':'hartford','bristol':'hartford','southington':'hartford',
  'newington':'hartford','glastonbury':'hartford','enfield':'hartford',
  'bloomfield':'hartford','manchester':'hartford','plainville':'hartford',
  'canton':'hartford','simsbury':'hartford','avon':'hartford',
  'farmington':'hartford','burlington':'hartford','granby':'hartford',
  'suffield':'hartford','windsor':'hartford','windsor locks':'hartford',
  'south windsor':'hartford','east windsor':'hartford','wethersfield':'hartford',
  'rocky hill':'hartford','berlin':'hartford',
  'middletown':'middlesex','old saybrook':'middlesex','clinton':'middlesex',
  'westbrook':'middlesex','essex':'middlesex','deep river':'middlesex',
  'chester':'middlesex','cromwell':'middlesex','portland':'middlesex',
  'east haddam':'middlesex','haddam':'middlesex','durham':'middlesex',
  'new london':'new_london','norwich':'new_london','groton':'new_london',
  'mystic':'new_london','waterford':'new_london','montville':'new_london',
  'colchester':'new_london','east lyme':'new_london','old lyme':'new_london',
  'ledyard':'new_london','stonington':'new_london','niantic':'new_london',
  'torrington':'litchfield','new milford':'litchfield','litchfield':'litchfield',
  'winsted':'litchfield','thomaston':'litchfield','harwinton':'litchfield',
  'cornwall':'litchfield','kent':'litchfield','salisbury':'litchfield',
  'sharon':'litchfield','woodbury':'litchfield','watertown':'litchfield',
  'stafford springs':'tolland','coventry':'tolland','tolland':'tolland',
  'ellington':'tolland','somers':'tolland','andover':'tolland',
  'bolton':'tolland','hebron':'tolland','vernon':'tolland','rockville':'tolland',
  'willimantic':'windham','putnam':'windham','plainfield':'windham',
  'killingly':'windham','brooklyn':'windham','woodstock':'windham',
  'ashford':'windham','eastford':'windham',
};

// ─── Helpers ────────────────────────────────────────────────────────

function parseCity(address) {
  if (!address) return null;
  const commaCtMatch = address.match(/,\s*([^,]+?)\s*,\s*CT\b/i);
  if (commaCtMatch) return commaCtMatch[1].trim().toLowerCase();
  const endCtMatch = address.match(/([^,]+?)\s*,\s*CT\b/i);
  if (endCtMatch) return endCtMatch[1].trim().toLowerCase();
  const spaceCtMatch = address.match(/,\s*(.+?)\s+CT\b/i);
  if (spaceCtMatch) return spaceCtMatch[1].trim().toLowerCase();
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) return parts[parts.length - 2].toLowerCase();
  return null;
}

// Bubble color: green (low) → amber (medium) → red (high) — matches the screenshot
function bubbleColor(t) {
  if (t > 0.65) return { bg: '#EF4444', border: '#FCA5A5' }; // red
  if (t > 0.35) return { bg: '#F59E0B', border: '#FDE68A' }; // amber
  return { bg: '#22C55E', border: '#86EFAC' };                // green
}

// Heat circle: radius in meters, grows with count
function heatRadius(t) {
  return 6500 + t * 11000; // 6.5km → 17.5km
}

// DivIcon for numbered bubble
function createBubbleIcon(count, maxCount) {
  const t     = maxCount > 0 ? count / maxCount : 0;
  const colors = bubbleColor(t);
  const size   = 28 + Math.round(t * 18); // 28px → 46px
  const fs     = size > 38 ? 13 : size > 32 ? 11 : 10;
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:${size}px;height:${size}px;
        background:${colors.bg};
        border:2.5px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:${fs}px;font-weight:800;color:white;
        font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
      ">${count}</div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor:[0, -(size / 2) - 4],
  });
}

const PERIODS = [
  { id: 'all',   label: 'All Time' },
  { id: 'year',  label: 'This Year' },
  { id: 'month', label: 'This Month' },
];

// CT bounding box for fitBounds
const CT_BOUNDS = [[40.95, -73.75], [42.05, -71.78]];

// ─── Component ──────────────────────────────────────────────────────
export default function LeadsHeatMap() {
  const [jobs, setJobs]     = useState([]);
  const [loading, setLoad]  = useState(true);
  const [period, setPeriod] = useState('all');

  useEffect(() => {
    supabase
      .from('jobs')
      .select('id, address, created_at, client_name')
      .then(({ data }) => { setJobs(data || []); setLoad(false); });
  }, []);

  const filtered = useMemo(() => {
    if (period === 'all') return jobs;
    const now = new Date();
    const cutoff = period === 'year'
      ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    return jobs.filter(j => new Date(j.created_at) >= cutoff);
  }, [jobs, period]);

  // City counts
  const cityCounts = useMemo(() => {
    const counts = {};
    filtered.forEach(j => {
      const city = parseCity(j.address);
      if (!city) return;
      counts[city] = (counts[city] || 0) + 1;
    });
    return counts;
  }, [filtered]);

  // Only cities that have coordinates
  const mappedPoints = useMemo(() =>
    Object.entries(cityCounts)
      .filter(([city]) => CITY_COORDS[city])
      .map(([city, count]) => ({ city, count, coords: CITY_COORDS[city] }))
      .sort((a, b) => b.count - a.count),
    [cityCounts]
  );

  const maxCount    = Math.max(...mappedPoints.map(p => p.count), 1);
  const totalMapped = mappedPoints.reduce((s, p) => s + p.count, 0);
  const topCities   = mappedPoints.slice(0, 8);

  return (
    <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-omega-orange" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-omega-charcoal leading-none">Lead Origins — Connecticut</h3>
            <p className="text-[11px] text-omega-stone mt-0.5">
              {loading ? 'Loading…' : `${totalMapped} of ${filtered.length} leads placed on map`}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                period === p.id
                  ? 'bg-omega-orange text-white shadow-sm'
                  : 'bg-gray-100 text-omega-stone hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[400px] flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-omega-orange border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex">
          {/* ── Map ── */}
          <div className="flex-1 min-w-0" style={{ height: '420px' }}>
            <MapContainer
              bounds={CT_BOUNDS}
              boundsOptions={{ padding: [20, 20] }}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
              zoomControl={true}
              attributionControl={true}
            >
              {/* Clean light tile (CartoDB Positron) — free, no API key */}
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
                maxZoom={19}
              />

              {/* ── Heat layer — large blurred circles ────────────── */}
              {/* CSS filter:blur on the pane creates the smooth heat effect */}
              <Pane
                name="heat"
                style={{ zIndex: 400, filter: 'blur(42px)', opacity: 0.82 }}
              >
                {mappedPoints.map(({ city, count, coords }) => {
                  const t = count / maxCount;
                  // Multi-ring: outer ring (lighter) + inner ring (darker)
                  return [
                    <Circle
                      key={`h-outer-${city}`}
                      center={coords}
                      radius={heatRadius(t) * 1.4}
                      pane="heat"
                      pathOptions={{
                        stroke: false,
                        fillColor: '#EF4444',
                        fillOpacity: 0.12 + t * 0.15,
                      }}
                    />,
                    <Circle
                      key={`h-inner-${city}`}
                      center={coords}
                      radius={heatRadius(t)}
                      pane="heat"
                      pathOptions={{
                        stroke: false,
                        fillColor: t > 0.5 ? '#DC2626' : '#F97316',
                        fillOpacity: 0.28 + t * 0.35,
                      }}
                    />,
                  ];
                })}
              </Pane>

              {/* ── Bubble markers ──────────────────────────────────── */}
              {mappedPoints.map(({ city, count, coords }) => (
                <Marker
                  key={`bubble-${city}`}
                  position={coords}
                  icon={createBubbleIcon(count, maxCount)}
                >
                  <Popup>
                    <div style={{ textAlign: 'center', minWidth: 100 }}>
                      <p style={{ fontWeight: 700, textTransform: 'capitalize', marginBottom: 2 }}>{city}</p>
                      <p style={{ color: '#6B7280', fontSize: 12 }}>
                        {count} lead{count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          {/* ── Top Cities Panel ── */}
          <div className="w-52 flex-shrink-0 border-l border-gray-100 px-4 py-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-omega-orange" />
              <p className="text-[11px] font-bold text-omega-stone uppercase tracking-wider">
                Top Cities
              </p>
            </div>

            {topCities.length === 0 ? (
              <p className="text-xs text-omega-stone italic">No address data found</p>
            ) : (
              <div className="space-y-3 flex-1">
                {topCities.map(({ city, count }, i) => {
                  const t      = count / maxCount;
                  const colors = bubbleColor(t);
                  return (
                    <div key={city} className="flex items-center gap-2.5">
                      {/* Rank badge */}
                      <span className="text-[10px] font-black text-omega-stone w-4 text-right flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <p className="text-[11px] font-semibold text-omega-charcoal capitalize truncate">{city}</p>
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: colors.bg + '22', color: colors.bg }}
                          >
                            {count}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round(t * 100)}%`,
                              background: colors.bg,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Legend */}
            <div className="border-t border-gray-100 pt-3 space-y-1.5">
              <p className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-2">Legend</p>
              {[
                { color: '#EF4444', label: 'High demand' },
                { color: '#F59E0B', label: 'Mid demand' },
                { color: '#22C55E', label: 'Low demand' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-[11px] text-omega-stone">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
