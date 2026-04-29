// Helpers for rendering subcontractors consistently across the app.
//
// Background: migration 022 split the old single `name` field into a
// company name (`name`) + a contact-person name (`contact_name`). The
// Omega field workflow uses the contact's personal name to recognize
// who they're talking to, not the LLC, so the canonical UI rule is:
//
//   * If the sub has a `contact_name`, display it as the primary line
//     and the `name` (company) as a smaller secondary line.
//   * If the sub only has `name` (legacy row, never edited since 022),
//     display it as the primary line with no secondary.
//
// Always go through this helper so we don't get drift between the
// SubcontractorCards, the JobSubcontractorsSection list, the Jarvis
// chat tool answers, dropdowns, etc.

/**
 * Pick the primary + secondary display strings for a subcontractor row.
 * @param {{ name?: string, contact_name?: string } | null | undefined} sub
 * @returns {{ primary: string, secondary: string | null }}
 */
export function subDisplayNames(sub) {
  const name = (sub?.name || '').trim();
  const contact = (sub?.contact_name || '').trim();

  if (contact && name && contact !== name) {
    return { primary: contact, secondary: name };
  }
  if (contact) {
    return { primary: contact, secondary: null };
  }
  return { primary: name || 'Untitled', secondary: null };
}

/**
 * Single-line label used in dropdowns, audit logs, search results,
 * Jarvis tool replies — anywhere we can only spend one line. Format:
 *   "Pedro Silva (ABC Plumbing LLC)"  when both exist
 *   "Pedro Silva"                     when only contact
 *   "ABC Plumbing LLC"                when only company
 * @param {{ name?: string, contact_name?: string } | null | undefined} sub
 * @returns {string}
 */
export function subInlineLabel(sub) {
  const { primary, secondary } = subDisplayNames(sub);
  return secondary ? `${primary} (${secondary})` : primary;
}
