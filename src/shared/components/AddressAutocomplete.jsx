/**
 * AddressAutocomplete — thin wrapper around Google Places Autocomplete.
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
 *
 * Graceful degradation: if VITE_GOOGLE_MAPS_API_KEY is not set, the component
 * renders a plain <input> so no functionality is lost.
 *
 * Loading strategy: the Maps JS script is injected once into <head> via a
 * module-level singleton promise — repeated mounts do NOT re-inject it.
 */

import { useEffect, useRef } from 'react';

// ── Singleton loader ───────────────────────────────────────────────────────
let _mapsPromise = null;

function loadGoogleMaps() {
  if (_mapsPromise) return _mapsPromise;

  _mapsPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      reject(new Error('VITE_GOOGLE_MAPS_API_KEY not set'));
      return;
    }
    // Already loaded (e.g. HMR re-mount)
    if (window.google?.maps?.places) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });

  return _mapsPromise;
}

// ── Helper: pull one component from the Places result ─────────────────────
function getComponent(components, type, short = false) {
  const c = components?.find((c) => c.types.includes(type));
  return c ? (short ? c.short_name : c.long_name) : '';
}

// ── Component ──────────────────────────────────────────────────────────────
export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = '123 Main St, Westport, CT 06880',
  className = '',
  autoFocus = false,
}) {
  const inputRef = useRef(null);
  const acRef    = useRef(null);   // google.maps.places.Autocomplete instance

  useEffect(() => {
    let mounted = true;

    loadGoogleMaps()
      .then(() => {
        if (!mounted || !inputRef.current) return;

        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ['address'],
          componentRestrictions: { country: 'us' },
          fields: ['address_components', 'formatted_address'],
        });
        acRef.current = ac;

        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place?.address_components) return;

          const comps = place.address_components;
          const streetNumber = getComponent(comps, 'street_number');
          const route        = getComponent(comps, 'route');
          const street       = [streetNumber, route].filter(Boolean).join(' ');
          const city =
            getComponent(comps, 'locality') ||
            getComponent(comps, 'sublocality_level_1') ||
            getComponent(comps, 'neighborhood');
          const state = getComponent(comps, 'administrative_area_level_1', true); // e.g. "CT"
          const zip   = getComponent(comps, 'postal_code');

          // Update the controlled input with the street portion
          onChange?.(street || place.formatted_address);

          // Give the parent everything it needs to fill sibling fields
          onPlaceSelected?.({
            street,
            city,
            state,
            zip,
            formatted: place.formatted_address,
          });
        });
      })
      .catch(() => {
        // Maps unavailable — input still works as plain text. No-op.
      });

    return () => {
      mounted = false;
      // Remove the pac-container dropdown that Google appended to <body>
      // when this input unmounts (avoids ghost dropdowns on navigation).
      if (acRef.current) {
        window.google?.maps?.event?.clearInstanceListeners?.(acRef.current);
      }
    };
  }, []); // runs once per mount

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="off"   /* suppress browser autocomplete behind Google's */
      autoFocus={autoFocus}
    />
  );
}
