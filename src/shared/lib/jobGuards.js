// Guards for pipeline moves (Ramon, 03/10).
//
// A job with a signed contract is a client: it goes In Progress →
// Completed and stays in Completed. It must never be dropped into Lost
// (which means "went through the estimate and didn't approve") or
// Disqualified (never really a client) — doing that to clear the board
// skewed the Lost totals and the conversion rate. The Completed column only
// shows the 10 most recent cards, so there's no need to move them anywhere.

import { supabase } from './supabase';

export const SIGNED_JOB_OFF_BOARD_MSG =
  'This job has a signed contract — move it to Completed, not Lost or Disqualified.';

// true when the job has a signed contract. A failed lookup never blocks.
export async function hasSignedContract(jobId) {
  if (!jobId) return false;
  const { data, error } = await supabase
    .from('contracts')
    .select('id')
    .eq('job_id', jobId)
    .eq('status', 'signed')
    .limit(1);
  if (error) return false;
  return (data || []).length > 0;
}
