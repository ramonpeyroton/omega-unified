// useUserProfile — load the `users` row that matches the current
// session's user, exposing the photo URL plus a refresh callback.
//
// The session user comes from Login.jsx with only { name, role } (no
// id, no profile_photo_url) — so each surface that needs the photo
// (sidebars, profile modal callers, etc) does its own DB lookup.
//
// Match strategy mirrors UserProfileModal:
//   * prefer user.id when the session carries one (future Phase 3),
//   * else case-insensitive name match against users.name,
//   * else null (fallback-PIN sessions whose name doesn't match a row).
//
// Pair with UserProfileModal's `onUserUpdated` prop: pass `refresh`
// so the sidebar's avatar updates the moment the user changes their
// photo without a full page reload.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useUserProfile(user) {
  const [profile, setProfile] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id && !user?.name) {
      setProfile(null);
      setLoaded(true);
      return;
    }
    let q = supabase
      .from('users')
      .select('id, name, role, phone, address, profile_photo_url');
    if (user.id) q = q.eq('id', user.id);
    else q = q.ilike('name', user.name.trim());
    const { data } = await q.maybeSingle();
    setProfile(data || null);
    setLoaded(true);
  }, [user?.id, user?.name]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    profile,
    loaded,
    refresh,
    photoUrl: profile?.profile_photo_url || null,
  };
}
