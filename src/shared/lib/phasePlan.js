// Who works each phase, and when. A phase can have several subs, each with
// its own dates — e.g. "Excavation & Foundation": the excavator Sep 1–3,
// the foundation company Sep 4–10 (Ramon, 02/10). Stored on the phase
// inside jobs.phase_data:
//
//   schedule: [{ id, sub_id, sub_name, start_date, end_date }]  ('YYYY-MM-DD')
//
// The phase also keeps start_date / end_date (earliest start, latest end)
// and sub_id / sub_name (first sub) as a summary for simple readers.
// Phases saved before `schedule` existed carry only those summary fields —
// planRows() reads them as a single row.

export function planRows(phase) {
  if (Array.isArray(phase?.schedule)) return phase.schedule;
  if (phase?.sub_id || phase?.sub_name || phase?.start_date || phase?.end_date) {
    return [{
      id: `${phase.id}_r1`,
      sub_id: phase.sub_id || null,
      sub_name: phase.sub_name || null,
      start_date: phase.start_date || null,
      end_date: phase.end_date || null,
    }];
  }
  return [];
}

let seq = 0;
// `id` is optional — the empty row shown on an unplanned phase passes a
// fixed one so it doesn't change on every render.
export function blankPlanRow(phase, id) {
  seq += 1;
  return {
    id: id || `${phase.id}_r${Date.now().toString(36)}${seq.toString(36)}`,
    sub_id: null, sub_name: null, start_date: null, end_date: null,
  };
}

// The phase with `rows` written back and its summary fields recomputed.
export function withPlanRows(phase, rows) {
  const starts = rows.map((r) => r.start_date).filter(Boolean).sort();
  const ends = rows.map((r) => r.end_date).filter(Boolean).sort();
  const first = rows.find((r) => r.sub_id || r.sub_name);
  return {
    ...phase,
    schedule: rows,
    start_date: starts[0] || null,
    end_date: ends[ends.length - 1] || null,
    sub_id: first?.sub_id || null,
    sub_name: first?.sub_name || null,
  };
}
