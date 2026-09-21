/**
 * AddressAutocomplete — address search powered by Photon (Komoot / OpenStreetMap).
 *
 * 100% free, no API key, no account. Focused on US addresses via country bias.
 *
 * Props:
 *   value            {string}   — controlled input value
 *   onChange         {fn}       — called with the new string as user types or
 *                                 after a place is selected (street portion only)
 *   onPlaceSelected  {fn}       — called when user picks a suggestion; receives
 *                                 { street, city, state, zip, formatted }
 *                                 so the parent can auto-fill sibling fields.
 *   placeholder      {string}
 *   className        {string}   — full className for the <input>
 *   autoFocus        {bool}
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const PHOTON_URL = 'https://photon.komoot.io/api/';

// US state abbreviation lookup
const STATE_ABBR = {
  Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',
  Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',
  Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',
  Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',
  Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',
  Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',
  Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI',
  'South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',
  Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',
  Wisconsin:'WI',Wyoming:'WY',
};

function abbrevState(name) {
  return STATE_ABBR[name] || name || '';
}

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = '123 Main St, Westport, CT 06880',
  className = '',
  autoFocus = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchSuggestions = useCallback(async (query) => {
    if (!query || query.length < 4) {
      setSuggestions([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        q: query,
        limit: '6',
        lang: 'en',
        // Bias toward Fairfield County CT area
        lat: '41.14',
        lon: '-73.26',
      });
      const resp = await fetch(`${PHOTON_URL}?${params}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const filtered = (data.features || []).filter(
        (f) => f.properties?.country === 'United States'
      );
      setSuggestions(filtered);
      setShowDropdown(true);
      setActiveIndex(-1);
    } catch {
      // Network issue — degrade silently
    }
  }, []);

  function handleInputChange(e) {
    const val = e.target.value;
    onChange?.(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  }

  function selectSuggestion(feature) {
    const p = feature.properties || {};
    const houseNumber = p.housenumber || '';
    const streetName = p.street || p.name || '';
    const street = [houseNumber, streetName].filter(Boolean).join(' ');
    const city = p.city || p.locality || p.district || '';
    const state = abbrevState(p.state || '');
    const zip = p.postcode || '';
    const formatted = [street, city, state, zip].filter(Boolean).join(', ');

    onChange?.(street || formatted);
    onPlaceSelected?.({ street, city, state, zip, formatted });
    setSuggestions([]);
    setShowDropdown(false);
  }

  function formatLabel(feature) {
    const p = feature.properties || {};
    const houseNumber = p.housenumber || '';
    const streetName = p.street || p.name || '';
    const street = [houseNumber, streetName].filter(Boolean).join(' ');
    const city = p.city || p.locality || '';
    const state = abbrevState(p.state || '');
    return { street, detail: [city, state].filter(Boolean).join(', ') };
  }

  function handleKeyDown(e) {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {suggestions.map((feat, i) => {
            const { street, detail } = formatLabel(feat);
            return (
              <li key={feat.properties?.osm_id || i}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(feat)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    i === activeIndex ? 'bg-omega-pale text-omega-charcoal' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="font-medium">{street || feat.properties?.name}</span>
                  {detail && <span className="text-gray-400 ml-1">{detail}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
