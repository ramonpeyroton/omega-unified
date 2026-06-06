import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useJobById(id) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    supabase.from('jobs').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setJob(data);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setJob(null);
        setLoading(false);
      });
    return () => { active = false; };
  }, [id]);
  return { job, setJob, loading };
}
