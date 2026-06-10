// ContractTemplate — full 7-page Omega construction contract, rendered
// editable on screen, exportable as PDF, and ready for DocuSign envelope
// creation. No AI involved — pure copy/paste of data already in Supabase
// into the legal template Ramon supplied.
//
// Source of truth for the static text (sections 1-25, Notice of
// Cancellation, etc.) is the OMEGA CONTRACT TEMPLATE.pdf shared by
// Ramon on 2026-04-30. Every editable field below corresponds to a
// blank in that PDF.
//
// Schedule A is auto-populated from the accepted estimate's sections,
// each item printed as: title + scope + price.
//
// PDF download is local — html2pdf.js renders the same DOM the user is
// editing into a Letter-sized PDF. Zero server cost, zero AI.
//
// DocuSign send is also DOM-based — buildContractDocFromDom() snapshots
// docRef.current with Brenda's edits and inlines computed styles so
// DocuSign's HTML→PDF renderer produces the same 11-page contract she
// just reviewed on screen. The server no longer carries a parallel
// template (the old short template caused a long-running content
// mismatch where clients received a 2-page summary).
//
// "Edit Contract Terms" (2026-06) — the legal text of the numbered
// sections can be rewritten PER ENVELOPE when a client negotiates
// custom terms (e.g. mutual indemnification). Overrides live in
// component state + sessionStorage only; CLAUSES below stays the
// untouched standard template for every other client.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Send, Lock, PencilLine, Undo2 } from 'lucide-react';

// Subset of CSS properties we replicate inline when serializing the
// contract DOM for DocuSign. Listed explicitly so the payload stays
// readable and we don't blast browser defaults at DocuSign's renderer.
const SERIALIZE_STYLE_PROPS = [
  'box-sizing',
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-color', 'border-style', 'border-width',
  'background', 'background-color', 'background-image',
  'color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'text-transform', 'white-space', 'word-break', 'overflow-wrap',
  'vertical-align',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
];

// Static legal copy is captured here so the JSX stays readable. Keep
// the wording identical to the supplied PDF — any change is a legal
// edit and should go through Ramon, not a refactor.
const CLAUSES = {
  s2_scope: `Contractor will provide all services, materials and labor for the Work to be performed with respect to the property located at __ADDRESS__ (hereinafter referred to as the "Property") as outlined in SCHEDULE A. This Agreement shall be strictly construed so that Contractor is not obligated to perform any work or services of any kind that is not clearly and expressly set forth in the attached Schedule A. Any work or services of any kind that is not clearly and expressly set forth in the attached Schedule A is excluded from this Agreement. Any additions, modifications, amendments or changes to the Work shall be the subject of a written change order which is executed by each party to this Agreement. Under no circumstances shall the scope of the Work be added to, modified, amended or changed orally, implicitly, by conduct, or by waiver, consent or acquiescence.

The Parties understand that a written change order shall be executed by the Parties in the event that additional work is required as a result of conditions already existing on the Property for which the Contractor becomes aware of during the regular performance of the work outlined in SCHEDULE A.`,
  s3_plans: `Owner shall make available to Contractor all plans, specifications, drawings, blueprints, and similar construction documents necessary for Contractor to provide the Work described herein. Any such materials shall remain the property of Owner.`,
  s4_site: `Owner warrants that he owns the Property and is authorized to enter into this Contract. Prior to the start of construction, Owner shall provide easy access to the Property, which meets all zoning requirements for the structure, and in which the boundaries of the Property will be clearly identified by stakes at all corners. Owner shall maintain these stakes are in proper position throughout construction.`,
  s5_permits: `Contractor shall obtain necessary building permits. Contractor shall apply for and obtain any other necessary permits and licenses required by the local municipal/county government to do the work. The cost of all Permits shall not be included in this Contract but shall be paid by the Owner.`,
  s7_payment_intro: `All payments shall be made payable to Contractor and may be mailed to 278 Post Road E, 2nd Floor, Westport, CT 06880 or made in person to an authorized agent for Contractor.`,
  s7_payment_late: `The Owner shall fully pay each invoice issued by the Contractor within three (3) days of Owner's receipt of said invoice. All invoices shall be sent to Owner via e-mail at the e-mail address listed above. Contractor's sending of an invoice to said e-mail address shall be deemed receipt of the invoice by Owner.

In the event that the Owner fails to make payment of any invoice when due, and such failure to pay continues for a period of ten (10) days or more after any such payment is due, the Contractor shall be entitled to cease or suspend performance of the Work until all outstanding amounts due by the Owner under the terms of this Agreement have been fully paid to the Contractor.

In the event that the Owner fails to make payment of any monthly installment of the contract price when due, and such failure to pay continues for a period of thirty (30) days or more after any such payment is due, interest shall accrue with respect to any such payment until it is paid at the rate of 12% per annum.`,
  s8_term: `Contractor shall commence the Work on the tentative date below and shall complete the work on or before the completion date below. The completion date shall be subject to change due to Unavoidable Delays as defined below and/or as a result of change orders entered into by the Parties which effectively modifies the scope of the Work.

Upon completion of the project, Owner agrees to sign a Notice of Completion within ten (10) days after the completion of the Work.`,
  s9_unavoidable: `In the event that Contractor shall be delayed in the performance of the Work by reason of Unavoidable Delay (as hereinafter defined), then performance of the Work shall be excused for the period of the Unavoidable Delay, and the Contractor shall not be deemed in breach or default of this Agreement by reason of such Unavoidable Delay. Unavoidable Delay shall mean any and all delays beyond the Contractor's reasonable control, including but not limited to delays related to permit approval, labor or material shortages beyond the reasonable control of the Contractor, weather conditions within which the Work cannot reasonably be performed, governmental restrictions, governmental regulations, governmental controls, order of civil, military or naval authority, governmental preemption, strikes, labor disputes, lock-outs, shortage of labor or materials, inability to obtain materials or reasonable substitutes therefor, Acts of God, fire, earthquake, floods, explosions, actions of the elements, extreme weather conditions or precipitation, civil commotion, riot or insurrection, delays caused by the Owner or third parties not under the direct control, supervision and direction of the Contractor, or other delays outside of the Contractor's reasonable control.`,
  s10_insurance: `Contractor shall make certificates of insurance available to Owner substantiating that Contractor has placed in force general insurance which is valid under the laws of the State of Connecticut.`,
  s11_access: `Owner shall allow free access to work areas for workers and vehicles and will allow areas for the storage of materials and debris. Driveways will be kept clear for the movement of vehicles during work hours.`,
  s12_photos: `Owner grants the Contractor permission to photograph and take video footage of the Property for purposes of documenting the Work. A camera may be installed at the Property solely for purposes of documenting the progress of the Work.

Owner permits Contractor to use the photographs and video footage of the Property documenting the Work for marketing and advertising, including but not limited to social media marketing and advertising. Contractor warrants and represents that the photographs and video footage shall be limited to the Work and no personal identifying photographs or video footage will be used or taken at any time. The Contractor shall own all copyrights to the photographs and video footage taken at the Property related to the Work.`,
  s13_utilities: `Owner shall provide and maintain water and electrical service, during the time of this Contract. Owner shall permit Contractor to use, at no cost, any electrical power and water use necessary to carry out and complete the Work.`,
  s14_inspection: `Owner shall have the right to inspect all Work performed under this Contract. All defects and uncompleted items shall be reported immediately and in writing, and at which time Contractor shall be permitted ten (10) days to provide notice to the Owner as to how and when such defects or uncompleted items will be cured.`,
  s15_default: `The occurrence of any of the following shall constitute a material default under this Contract:
a. The failure of Owner to make a required payment when due.
b. The insolvency of either party or if either party shall, either voluntarily or involuntarily, become a debtor of or seek protection under Title 11 of the United States Bankruptcy Code.
c. A lawsuit is brought on any claim, seizure, lien or levy for labor performed or materials used on or furnished to the project by either party, or there is a general assignment for the benefit of creditors, application or sale for or by any creditor or government agency brought against either party.
d. The failure of Owner to make the building site available or the failure of Contractor to deliver the Services in manner provided for in this Agreement.`,
  s16_remedies: `In addition to any and all other rights a party may have available according to law of the State of Connecticut, if a party defaults by failing to substantially perform any provision, term or condition of this Contract (including without limitation the failure to make a monetary payment when due), the other party may terminate the Contract by providing written notice to the defaulting party. This notice shall describe with sufficient detail the nature of the default. The party receiving said notice shall have 30 days from the effective date of said notice to cure the default(s) or begin substantial completion if completion cannot be made in 30 days. Unless expressly waived by a party providing notice, the failure to cure or begin curing, the default(s) within such time period shall result in the automatic termination of this Contract.`,
  s17_force: `If performance of this Contract or any obligation thereunder is prevented, restricted, or interfered with by causes beyond either party's reasonable control ("Force Majeure"), and if the party unable to carry out its obligations gives the other party prompt written notice of such event, then the obligations of the party invoking this provision shall be suspended to the extent necessary by such event. The term Force Majeure shall include, but not be limited to, acts of God, fire, explosion, vandalism, storm, casualty, illness, injury, general unavailability of materials or other similar occurrence, orders or acts of military or civil authority, or by national emergencies, insurrections, riots, or wars, or strikes, lockouts, work stoppages. The excused party shall use reasonable efforts under the circumstances to avoid or remove such causes of non-performance and shall proceed to perform with reasonable dispatch whenever such causes are removed or ceased. An act or omission shall be deemed within the reasonable control of a party if committed, omitted, or caused by such party, or its employees, officers, agents, or affiliates.`,
  s18_indemnity: `Owner shall fully and unconditionally surrender, release, discharge, relinquish, defend, hold harmless and indemnify the Contractor and all of its principals, owners, shareholders, members, partners, parents, affiliates, subsidiaries, successors, directors, officers, employees, agents, servants or representatives from and against any and all costs, expenses, legal fees, losses, claims, actions, suits, demands, penalties, liabilities or damages in any way arising out of or related to this Agreement or the Work, unless any such costs, expenses, legal fees, losses, claims, actions, suits, demands, penalties, liabilities or damages are solely and directly caused by the intentional or willful misconduct or recklessness of the Contractor, or solely and directly caused by a material breach of this Agreement by the Contractor.

Notwithstanding any other terms or conditions of this Agreement to the contrary, the Owner shall fully and unconditionally surrender, release, discharge, relinquish and hold harmless the Contractor and all of its principals, owners, shareholders, members, partners, parents, affiliates, subsidiaries, successors, directors, officers, employees, agents, servants or representatives from any and all indirect, incidental, punitive, exemplary or consequential damages, including but not limited to any claims for lost opportunity, impact damages, loss of income, loss of profits, loss of business or business opportunity, loss of efficiency or productivity, loss of financing, damage to reputation or goodwill, or any delay or disruption damages.

Notwithstanding any other terms or conditions in this Agreement to the contrary, the Owner shall fully and unconditionally surrender, release, discharge, relinquish, defend, hold harmless and indemnify the Contractor and all of its principals, owners, shareholders, members, partners, parents, affiliates, subsidiaries, successors, directors, officers, employees, agents, servants or representatives from and against any and all costs, expenses, legal fees, losses, claims, actions, suits, demands, penalties, liabilities or damages that are or should be covered by any insurance maintained by the Owner.`,
  s19_severability: `If any provision of this Agreement will be held to be invalid or unenforceable for any reason, the remaining provisions will continue to be valid and enforceable. If a court finds that any provision of this Agreement is invalid or unenforceable, but that by limiting such provision it would become valid and enforceable, then such provision will be deemed to be written, construed, and enforced as so limited.`,
  s20_amendment: `This Agreement may be modified or amended in writing, if the writing is signed by each party. This Agreement shall not be modified, amended or changed orally, implicitly, by conduct, or by waiver, consent or acquiescence, but only by a written instrument, signed by all parties hereto, expressly acknowledging that this Agreement is being modified, amended or changed by virtue of said written instrument.`,
  s21_governing: `This Agreement shall be construed in accordance with and governed by the laws of the State of Connecticut, without regard to any choice of law provisions of Connecticut or any other jurisdiction.`,
  s22_notice: `Any notice or communication required or permitted under this Agreement shall be sufficiently given if delivered by electronic mail or certified mail, return receipt requested to the address set forth in the opening paragraph, or to such other address as one party may have furnished to the other in writing.`,
  s23_no_waiver: `Any delay, waiver or omission of the Contractor in exercising or enforcing any right, term or condition under this Agreement, whether implicitly, by conduct, or by waiver, consent or acquiescence, shall not in any way impair the Contractor's exercise or enforcement of such right, term or condition on any other, further or subsequent occasion.

Any delay, waiver or omission of the Contractor in exercising or enforcing any right, term or condition under this Agreement shall not be construed in any way as a waiver or surrender of any such right, term or condition, or as acquiescence, consent or agreement to conduct in contravention of any such right, term or condition.`,
  s24_legal: `The Owner shall be liable to the Contractor for any costs, expenses or legal fees incurred by the Contractor in enforcing any obligation of the Owner under the terms and conditions of this Agreement, or remedying or curing any breach or failure to perform of the Owner under the terms and conditions of this Agreement.`,
  s25_entire: `This Agreement constitutes the entire agreement of the parties. There are no oral or collateral terms or conditions agreed to by the parties concerning the subject matter of this Agreement or the Work that are not reflected herein. There are no oral or collateral understandings or inducements between the parties concerning the subject matter of this Agreement or the Work that are not reflected herein.`,
  s26_warranty: `Contractor provides a three (3) year warranty on craftsmanship and labor performed under this Agreement, commencing on the date of Substantial Completion of the Work. During the warranty period, Contractor shall, at no additional cost to Owner, repair or correct any defects in workmanship attributable to Contractor's performance of the Work.

This warranty does NOT cover: (a) damage caused by clogged drains or by the introduction into the plumbing system of materials, debris, grease, hair, foreign objects or any item not intended for normal drainage; (b) damage caused by Owner's misuse, neglect, lack of maintenance, alteration, or repairs performed by parties other than Contractor; (c) damage caused by acts of God, fire, flood, water intrusion not attributable to Contractor's work, or other casualty beyond Contractor's reasonable control; or (d) normal wear and tear.

To make a warranty claim, Owner must notify Contractor in writing within thirty (30) days of discovering the defect. The remedies provided in this warranty are Owner's exclusive remedies for any defect in workmanship and labor.`,
  cancel_short: `Owner may cancel this transaction at any time prior to midnight on the third business day after the date of this transaction. SEE THE ATTACHED NOTICE OF CANCELLATION FOR AN EXPLANATION OF THIS RIGHT.`,
  cancel_full: `YOU MAY CANCEL THIS TRANSACTION WITHOUT ANY PENALTY OR OBLIGATION, WITHIN THREE BUSINESS DAYS FROM THE ABOVE DATE.

IF YOU CANCEL, ANY PROPERTY TRADED IN, ANY PAYMENTS MADE BY YOU UNDER THE CONTRACT OR SALE, AND ANY NEGOTIABLE INSTRUMENT EXECUTED BY YOU WILL BE RETURNED WITHIN TEN BUSINESS DAYS FOLLOWING RECEIPT BY THE SELLER OF YOUR CANCELLATION NOTICE, AND ANY SECURITY INTEREST OUT OF THE TRANSACTION WILL BE CANCELED.

IF YOU CANCEL, YOU MUST MAKE AVAILABLE TO THE SELLER AT YOUR RESIDENCE, IN SUBSTANTIALLY AS GOOD CONDITION AS WHEN RECEIVED, ANY GOODS DELIVERED TO YOU UNDER THIS CONTRACT OR SALE; OR YOU MAY, IF YOU WISH, COMPLY WITH THE INSTRUCTIONS OF THE SELLER REGARDING THE RETURN SHIPMENT OF THE GOODS AT THE SELLER'S EXPENSE AND RISK. IF YOU DO MAKE THE GOODS AVAILABLE TO THE SELLER AND THE SELLER DOES NOT PICK THEM UP WITHIN TWENTY DAYS OF THE DATE OF THE CANCELLATION, YOU MAY RETAIN OR DISPOSE OF THE GOODS WITHOUT ANY FURTHER OBLIGATION. IF YOU FAIL TO MAKE THE GOODS AVAILABLE TO THE SELLER, OR IF YOU AGREE TO RETURN THE GOODS TO THE SELLER AND FAIL TO DO SO, THEN YOU REMAIN LIABLE FOR PERFORMANCE OF ALL OBLIGATIONS UNDER THE CONTRACT.

TO CANCEL THIS TRANSACTION, MAIL OR DELIVER A SIGNED AND DATED COPY OF THIS CANCELLATION NOTICE OR ANY OTHER WRITTEN NOTICE, TO OMEGA DEVELOPMENT, LLC AT 278 POST ROAD E, 2ND FLOOR, WESTPORT, CT 06880 NO LATER THAN MIDNIGHT OF (third business day after the date of this transaction).`,
};

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Format YYYY-MM-DD as "Month DD, YYYY" for the static contract snapshot
// sent to DocuSign. Falls through with the raw value when format is off.
function fmtIsoDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map((s) => Number(s));
  if (!y || !m || !d) return iso;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Snapshot the live, edited contract DOM into a self-contained HTML
// document so it can be sent verbatim to DocuSign. Inputs become spans
// containing the edited value (so Brenda's name/date/initials show up),
// Tailwind classes are flattened to inline styles via getComputedStyle
// (so DocuSign's renderer doesn't need our stylesheet), and the
// signature image keeps its relative URL — the server replaces it with
// a base64 data URL before forwarding to DocuSign.
// Exported so EstimateFlow can re-serialize the contract from the
// Awaiting Signature step (one-click resend for testing).
export function buildContractDocFromDom(rootEl) {
  if (!rootEl) return '';

  // Walk the live DOM (already mounted on screen) and build a clone
  // with computed styles flattened to inline. Earlier we tried mounting
  // an off-screen 7.5in "mirror" to control width — but the off-screen
  // positioning hacks (position:absolute; left:-99999px) bled through
  // into the serialized clone and DocuSign rendered the contract off-
  // page (blank PDF). The width-skip in copyInlineStyles below already
  // prevents viewport-pixel widths from leaking into the output; it
  // makes the mirror redundant.
  const clone = rootEl.cloneNode(true);

  function walk(live, copy) {
    if (!live || !copy || copy.nodeType !== 1) return;

    // Replace inputs (text/date) with plain spans containing their edited
    // value. Date values are formatted en-US for legal readability.
    if (copy.tagName === 'INPUT') {
      const span = document.createElement('span');
      const type = copy.getAttribute('type') || 'text';
      const raw  = live.value || '';
      const txt  = (type === 'date') ? fmtIsoDate(raw) : raw;
      span.textContent = txt || '       ';
      copyInlineStyles(live, span);
      // Reset on-screen yellow highlight — operator review only, must
      // not bleed into the contract sent to the client.
      span.style.background = 'transparent';
      span.style.backgroundColor = 'transparent';
      copy.replaceWith(span);
      return;
    }

    // Clause-editing textareas become plain text blocks. Handled here
    // (not just by exiting edit mode before send) so a serialization
    // that runs while edit mode is still mounted can never ship a raw
    // <textarea> to DocuSign.
    if (copy.tagName === 'TEXTAREA') {
      const div = document.createElement('div');
      div.textContent = live.value || '';
      copyInlineStyles(live, div);
      div.style.background = 'transparent';
      div.style.backgroundColor = 'transparent';
      div.style.border = 'none';
      div.style.padding = '0';
      div.style.whiteSpace = 'pre-line';
      // The auto-grow hook bakes a pixel height inline — drop it so the
      // text block flows naturally across PDF page breaks.
      div.style.height = 'auto';
      copy.replaceWith(div);
      return;
    }

    copyInlineStyles(live, copy);
    copy.removeAttribute('class');

    const liveKids = Array.from(live.children);
    const copyKids = Array.from(copy.children);
    const len = Math.min(liveKids.length, copyKids.length);
    for (let i = 0; i < len; i++) walk(liveKids[i], copyKids[i]);
  }

  // Recursive font-size scale. Walked over the serialized clone after
  // styles are inlined — multiplies every px-based font-size by `factor`
  // so the printed contract isn't tiny in the DocuSign-rendered PDF.
  function scaleFontSizes(node, factor) {
    if (!node || node.nodeType !== 1) return;
    const fs = node.style.fontSize;
    if (fs && /^[\d.]+px$/.test(fs)) {
      const px = parseFloat(fs);
      if (!isNaN(px) && px > 0) {
        node.style.fontSize = (px * factor).toFixed(2) + 'px';
      }
    }
    for (const kid of Array.from(node.children)) scaleFontSizes(kid, factor);
  }

  function copyInlineStyles(live, copy) {
    try {
      const cs = window.getComputedStyle(live);
      const decls = [];
      for (const prop of SERIALIZE_STYLE_PROPS) {
        // Don't bake captured pixel widths/heights for elements that
        // had no inline width to begin with. Those came from Tailwind
        // classes and should stay fluid so the printed-page container
        // drives their final size — not whatever the operator's window
        // happened to be when serialization ran.
        if ((prop === 'width' || prop === 'height' ||
             prop === 'min-width' || prop === 'min-height' ||
             prop === 'max-width' || prop === 'max-height') &&
            !live.style[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) {
          continue;
        }
        const v = cs.getPropertyValue(prop);
        if (!v) continue;
        if ((prop === 'margin' || prop === 'padding') && v === '0px') continue;
        if (prop === 'border-radius' && v === '0px') continue;
        if (prop === 'opacity' && v === '1') continue;
        decls.push(`${prop}:${v}`);
      }
      if (decls.length) {
        const existing = copy.getAttribute('style') || '';
        // Computed first, existing inline last — author intent in JSX
        // (e.g. style={{ width: '40px' }} on the orange divider) wins
        // over the bulk computed-style flatten.
        copy.setAttribute('style', existing ? `${decls.join(';')};${existing}` : decls.join(';'));
      }
    } catch { /* getComputedStyle can throw in detached/weird contexts */ }
  }

  walk(rootEl, clone);

  // Defensive post-walk pass: force every <p> to be a full-width block
  // and clear any text-center container that lost its width. DocuSign's
  // renderer has been observed to collapse the cancellation paragraph
  // into a 50px-wide column on the right of the page and we cannot
  // pin down the exact CSS that triggers it. Brute-forcing block flow
  // here guarantees the contract body fills the page either way.
  clone.querySelectorAll('p').forEach((p) => {
    p.style.maxWidth = 'none';
    p.style.width = 'auto';
    p.style.display = 'block';
  });
  clone.querySelectorAll('div').forEach((d) => {
    if (d.style.textAlign === 'center' && !d.style.width) {
      d.style.width = '100%';
    }
  });

  // Bump every captured font-size 50% so the contract reads at roughly
  // Word size 12 (≈16px) in the DocuSign-rendered PDF. The on-screen
  // template uses text-[12.5px]/text-[13px] which prints too small
  // once DocuSign rasterizes.
  scaleFontSizes(clone, 1.5);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  /* Body fills the Letter page; padding creates the print margin.
     box-sizing keeps the math sane regardless of DocuSign's renderer. */
  html, body { margin: 0; padding: 0; }
  body {
    padding: 0.5in;
    background: #ffffff;
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .contract-pagebreak { page-break-before: always; break-before: page; height: 0; }
  img { max-width: 100%; }
  /* DocuSign's HTML→PDF renderer sometimes interprets a max-width
     captured upstream as a hard width. Defensive override so paragraphs
     and the cancellation block fill the page rather than collapsing
     into a narrow column on the right. */
  p { max-width: none !important; width: auto !important; display: block !important; }
  /* Ensure tables (used for signature + cancellation footer + total
     bar) stay full-width even if computed values bake something
     smaller. */
  table { width: 100% !important; border-collapse: collapse; }
  /* Belt-and-suspenders against the yellow #fef08a operator-review
     highlight bleeding into headings/paragraphs. Inputs are already
     stripped at replace-time; this catches any leak via inheritance
     or quirky computed-style behavior in DocuSign's renderer. */
  h1, h2, h3, h4, h5, h6, p, table, tr, td, tbody, thead { background: transparent !important; background-color: transparent !important; }
</style>
</head>
<body>
${clone.outerHTML}
</body>
</html>`;
}

// Pull line items out of the estimate. EstimateBuilder persists `sections`
// on the row, but legacy estimates may still have `line_items`. Support
// both shapes so the contract Schedule A always has something to print.
function readScheduleA(estimate) {
  if (Array.isArray(estimate?.sections) && estimate.sections.length) {
    return estimate.sections.map((s) => ({
      title: s.title || 'Untitled section',
      items: (s.items || []).map((it) => ({
        description: it.description || it.item || '',
        scope: it.scope || '',
        price: Number(it.price) || 0,
      })).filter((it) => it.description || it.scope || it.price),
    })).filter((s) => s.items.length);
  }
  if (Array.isArray(estimate?.line_items) && estimate.line_items.length) {
    return [{
      title: 'Description of Work',
      items: estimate.line_items.map((li) => ({
        description: li.description || li.item || '',
        scope: li.scope || '',
        price: Number(li.price) || 0,
      })),
    }];
  }
  return [];
}

export default function ContractTemplate({
  job, estimate, paymentPlan,
  canSendDocuSign,
  onSendDocuSign,
  saving,
}) {
  const docRef = useRef(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // ─── Editable fields with sensible defaults ──────────────────────
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [beginningDate, setBeginningDate] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [ownerName, setOwnerName]       = useState(job?.client_name || '');
  const [ownerAddress, setOwnerAddress] = useState(job?.address || '');
  const [ownerEmail, setOwnerEmail]     = useState(job?.client_email || '');
  const [propertyAddress, setPropertyAddress] = useState(job?.address || '');
  const [initialDepositDate, setInitialDepositDate] = useState('');

  // Sync owner fields whenever the underlying `job` prop changes.
  // Without these, the useState initializers above run once on mount
  // and freeze the values — so fixing a typo in the job card while
  // the contract step is mounted would silently send the DocuSign
  // envelope with the stale info. Audit #8.
  useEffect(() => { setOwnerName(job?.client_name || ''); },     [job?.client_name]);
  useEffect(() => { setOwnerEmail(job?.client_email || ''); },   [job?.client_email]);
  useEffect(() => {
    // Address powers BOTH ownerAddress and propertyAddress by default.
    setOwnerAddress(job?.address || '');
    setPropertyAddress(job?.address || '');
  }, [job?.address]);

  // ─── Per-envelope clause overrides ("Edit Contract Terms") ────────
  // Lets the sender rewrite the legal text (and title) of any numbered
  // section for THIS contract only. CLAUSES is never mutated — overrides
  // live in state, mirrored to sessionStorage per job so a navigation
  // inside the app doesn't lose a long legal edit. At send time they are
  // baked into the serialized HTML like every other on-screen edit.
  const overridesKey = `omega-contract-clauses-${job?.id || 'no-job'}`;
  const [editTerms, setEditTerms] = useState(false);
  const [clauseOverrides, setClauseOverrides] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(overridesKey) || '{}') || {}; }
    catch { return {}; }
  });
  useEffect(() => {
    try {
      if (Object.keys(clauseOverrides).length === 0) sessionStorage.removeItem(overridesKey);
      else sessionStorage.setItem(overridesKey, JSON.stringify(clauseOverrides));
    } catch { /* storage blocked — edits still live in state */ }
  }, [clauseOverrides, overridesKey]);

  const overrideCount = Object.keys(clauseOverrides).length;
  const clause = (key, base) =>
    clauseOverrides[key] !== undefined
      ? clauseOverrides[key]
      : (base !== undefined ? base : CLAUSES[key]);
  const setClause = (key) => (e) =>
    setClauseOverrides((o) => ({ ...o, [key]: e.target.value }));
  const titleKey = (key) => `${key}__title`;

  // Section title — plain string normally, inline input in edit mode
  // (e.g. retitling §18 when indemnification becomes mutual).
  function clauseTitle(key, defaultTitle) {
    const val = clause(titleKey(key), defaultTitle);
    if (!editTerms) return val;
    return (
      <input
        value={val}
        onChange={setClause(titleKey(key))}
        className="font-bold text-[11px] uppercase tracking-[0.08em] text-gray-900 border border-amber-300 rounded px-1 focus:outline-none focus:border-omega-orange"
        style={{ width: `${Math.max(String(val).length + 4, 24)}ch`, maxWidth: '100%' }}
      />
    );
  }

  // Section body — string (whitespace-pre-line via <Section>) normally,
  // auto-growing textarea in edit mode.
  function clauseBody(key, base) {
    const val = clause(key, base);
    if (!editTerms) return val;
    return <AutoGrowTextarea value={val} onChange={setClause(key)} />;
  }

  // Loose clause paragraph (inside §7/§8 which mix fixed inputs with
  // template text) — same edit behavior, keeps its own <p> styling.
  function clausePara(key, className = '') {
    if (editTerms) {
      return <div className={className}><AutoGrowTextarea value={clause(key)} onChange={setClause(key)} /></div>;
    }
    return <p className={`${className} whitespace-pre-line`.trim()}>{clause(key)}</p>;
  }

  function resetClauseOverrides() {
    if (!window.confirm('Discard ALL custom terms for this contract and restore the standard template text?')) return;
    setClauseOverrides({});
  }

  const schedule = useMemo(() => readScheduleA(estimate), [estimate]);
  // Total comes from estimate.total_amount (which is the merged sum
  // of every selected estimate's total). The previous Math.max defense
  // was over-eager — if a stale section price-sum was higher than the
  // real total, Math.max would surface the wrong number. The merge in
  // EstimateFlow already guarantees estimate.total_amount is correct,
  // so we just trust it. If it's somehow missing we fall back to the
  // schedule sum, then the payment plan sum.
  const totalAmount = useMemo(() => {
    const fromEstimate = Number(estimate?.total_amount) || 0;
    if (fromEstimate > 0) return fromEstimate;
    const sumFromSchedule = schedule.reduce(
      (acc, s) => acc + s.items.reduce((sum, it) => sum + (it.price || 0), 0),
      0
    );
    if (sumFromSchedule > 0) return sumFromSchedule;
    return Array.isArray(paymentPlan)
      ? paymentPlan.reduce((s, p) => s + (Number(p?.amount) || 0), 0)
      : 0;
  }, [estimate, schedule, paymentPlan]);

  async function downloadPDF() {
    if (!docRef.current) return;
    setPdfDownloading(true);
    setPdfError('');
    const highlighted = Array.from(docRef.current.querySelectorAll('input, textarea'));
    highlighted.forEach((el) => (el.style.backgroundColor = 'transparent'));
    // Apply page-break CSS only during PDF export — keeping it out of the static
    // stylesheet prevents the browser from rendering a dark separator on screen.
    const pageBreaks = Array.from(docRef.current.querySelectorAll('.contract-pagebreak'));
    pageBreaks.forEach((el) => {
      el.style.breakBefore = 'page';
      el.style.pageBreakBefore = 'always';
    });
    try {
      // Load html2pdf from CDN to avoid Vite ESM bundling issues with this
      // legacy library. The script is injected once and reused on subsequent clicks.
      const html2pdf = await new Promise((resolve, reject) => {
        if (window.html2pdf) { resolve(window.html2pdf); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        s.onload = () => resolve(window.html2pdf);
        s.onerror = () => reject(new Error('Could not load html2pdf.js from CDN'));
        document.head.appendChild(s);
      });
      const filename = `omega-contract-${(ownerName || 'client').replace(/[^a-z0-9-]/gi, '_').slice(0, 40)}-${todayIso()}.pdf`;
      await html2pdf()
        .set({
          margin: [0.6, 0.6, 0.7, 0.6],
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          // 'avoid-all' tells html2pdf to scan all common block elements (p, h*,
          // li, etc.) and never slice them across page boundaries — combined
          // with our explicit selectors, no text line is ever cut in half.
          pagebreak: {
            mode: ['avoid-all', 'css', 'legacy'],
            before: '.contract-pagebreak',
            avoid: ['.contract-section', '.contract-initials', '.contract-signature', 'p', 'li', 'h1', 'h2', 'h3'],
          },
        })
        .from(docRef.current)
        .save();
    } catch (err) {
      setPdfError(err?.message || 'Could not generate the PDF.');
    } finally {
      highlighted.forEach((el) => (el.style.backgroundColor = ''));
      pageBreaks.forEach((el) => {
        el.style.breakBefore = '';
        el.style.pageBreakBefore = '';
      });
      setPdfDownloading(false);
    }
  }

  const [contractorSignDate, setContractorSignDate] = useState(todayIso());

  // Single shared initials value — pre-fills all 4 initials boxes at once on
  // screen. DocuSign will create independent initials tabs per page so the
  // client must initial each one individually.
  const [ownerInitials, setOwnerInitials] = useState('');

  // Snapshot the current DOM and hand the HTML to the parent flow. The
  // parent passes it to /api/docusign/create-envelope verbatim so the
  // client receives the exact 11-page contract Brenda just reviewed.
  async function handleSendDocuSignClick() {
    if (!docRef.current || !onSendDocuSign) return;
    // Leave edit mode so the operator sees the final text; the DOM
    // serializer also converts any still-mounted textarea to plain text,
    // so the envelope is correct either way.
    setEditTerms(false);
    const html = buildContractDocFromDom(docRef.current);
    await onSendDocuSign(html, { editedClauses: Object.keys(clauseOverrides) });
  }

  // Inline editable field — underlined, blends with printed contract.
  // Heights/alignment handled via the <style> block at the bottom so all
  // inputs can grow with their content (no clipping of long values).
  const inputCls = 'inline-block px-1 border-b-[1.5px] border-gray-500 bg-transparent focus:outline-none focus:border-omega-orange text-[13px] print:border-b-black';
  const numCls   = `${inputCls} text-right tabular-nums`;
  const blockCls = 'w-full px-2 py-1 mt-1 border border-gray-200 rounded bg-white focus:outline-none focus:border-omega-orange print:border-0';

  // Auto-size text inputs based on their value/placeholder. Returns a width
  // in `ch` units that grows with the content so values like long addresses
  // or emails are never clipped on screen or in the PDF.
  function autoWidth(value, placeholder = '', minChars = 14) {
    const text = (value || placeholder || '').toString();
    const ch   = Math.max(text.length + 2, minChars);
    return { width: `${ch}ch`, maxWidth: '100%' };
  }

  // Derived display
  const planRows = (paymentPlan || []).map((p, i) => ({
    label: p.label || `Payment ${i + 1}`,
    percent: Number(p.percent) || 0,
    amount: Number(p.amount) || (totalAmount ? totalAmount * (Number(p.percent) / 100) : 0),
    due_date: p.due_date || '',
  }));

  return (
    <div>
      {/* ── Per-envelope terms toolbar ── */}
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs max-w-xl">
          {editTerms ? (
            <span className="inline-block p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 leading-relaxed">
              <strong>Editing legal terms for THIS contract only.</strong>{' '}
              The standard template is not changed. Rewrite any section below,
              then click "Done editing" and review before sending.
            </span>
          ) : overrideCount > 0 ? (
            <span className="inline-block px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
              Custom terms active — {overrideCount} edit{overrideCount > 1 ? 's' : ''} apply to this contract only.
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {overrideCount > 0 && (
            <button
              onClick={resetClauseOverrides}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-red-300 hover:text-red-600 text-xs font-semibold text-omega-stone transition"
            >
              <Undo2 className="w-3.5 h-3.5" /> Reset to standard terms
            </button>
          )}
          <button
            onClick={() => setEditTerms((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              editTerms
                ? 'bg-omega-orange border-omega-orange text-white hover:bg-omega-dark'
                : 'border-gray-200 hover:border-omega-orange text-omega-charcoal'
            }`}
          >
            <PencilLine className="w-3.5 h-3.5" />
            {editTerms ? 'Done editing' : 'Edit Contract Terms'}
          </button>
        </div>
      </div>

      {/* ───────────────────── DOCUMENT BODY ───────────────────── */}
      <div
        ref={docRef}
        className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm contract-doc"
        style={{ fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}
      >
        {/* Brand accent bar */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, #E8500A 0%, #2C2C2C 100%)' }} />

        <div className="px-12 py-10 text-[13px] leading-[1.75] text-gray-800">

          {/* ── Header ── */}
          <div className="text-center mb-10 pb-8 border-b border-gray-100">
            <p className="text-[9px] tracking-[0.4em] text-omega-orange uppercase font-semibold mb-3">
              Omega Development LLC &nbsp;·&nbsp; Westport, CT
            </p>
            <h1 className="text-[22px] font-black tracking-[0.14em] uppercase text-gray-900 mb-2">
              Construction Contract
            </h1>
            <p className="text-[9px] tracking-[0.25em] text-gray-400 uppercase">
              HIC.0670573 &nbsp;·&nbsp; NHC.0017262
            </p>
          </div>

          {/* ── Opening paragraph ── */}
          <p className="mb-4">
            This Construction Contract (the "Contract" or "Agreement") is made as of{' '}
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputCls} />
            {' '}(the "Effective Date") by and between{' '}
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner full name"
              className={inputCls} style={autoWidth(ownerName, 'Owner full name', 23)} />
            {' '}of address:
          </p>
          <p className="mb-1 -mt-2">
            <input value={ownerAddress} onChange={(e) => setOwnerAddress(e.target.value)} placeholder="Street address, City, State ZIP"
              className={inputCls} style={{ width: '100%', display: 'block' }} />
          </p>
          <p className="mb-4">
            (hereinafter referred to "Owner") and OMEGA DEVELOPMENT LLC (hereinafter referred to as "Contractor")
            Registration numbers: HIC.0670573 and NHC.0017262.
          </p>
          <p className="mb-7">
            In consideration of the mutual promises set forth below, the parties agree to the following terms and conditions:
          </p>

          {/* ── §1 ── */}
          <Section number="1" title="DESCRIPTION OF SERVICES.">
            Beginning on{' '}
            <input type="date" value={beginningDate} onChange={(e) => setBeginningDate(e.target.value)} className={inputCls} />
            , Contractor will provide to owner the services described in the attached SCHEDULE A
            (collectively, the "Work" Estimate.)
          </Section>

          {/* ── §2 ── */}
          <Section number="2" title={clauseTitle('s2_scope', 'SCOPE OF WORK.')}>
            {clauseBody('s2_scope', CLAUSES.s2_scope.replace('__ADDRESS__', propertyAddress || '___'))}
          </Section>

          {/* ── §3–5 ── */}
          <Section number="3" title={clauseTitle('s3_plans', 'PLANS, SPECIFICATIONS AND CONSTRUCTION DOCUMENTS.')}>
            {clauseBody('s3_plans')}
          </Section>
          <Section number="4" title={clauseTitle('s4_site', 'WORK SITE.')}>
            {clauseBody('s4_site')}
          </Section>
          <Section number="5" title={clauseTitle('s5_permits', 'PERMITS.')}>
            {clauseBody('s5_permits')}
          </Section>
          <Section number="6" title="MATERIALS AND/OR LABOR">
            Refer to Schedule A.
          </Section>

          <div className="contract-pagebreak" />

          {/* ── §7 — Payment Schedule ── */}
          <Section number="7" title="PAYMENT SCHEDULE.">
            <p className="mb-2">
              Owner agrees to pay Contractor the total sum of{' '}
              <span className="font-bold">{fmtMoney(totalAmount)}</span>.
            </p>
            {clausePara('s7_payment_intro', 'mb-3')}
            <p className="mb-2 font-semibold">Payments shall be made as follows:</p>
            <p className="mb-2">
              Initial deposit shall be due on{' '}
              <input type="date" value={initialDepositDate} onChange={(e) => setInitialDepositDate(e.target.value)} className={inputCls} />
              {' '}in the amount of{' '}
              <span className="font-bold">
                {planRows[0] ? fmtMoney(planRows[0].amount) : fmtMoney(0)}
              </span>.
            </p>
            <ol className="list-decimal pl-5 my-3 space-y-1">
              {planRows.map((p, i) => (
                <li key={i}>
                  <span className="font-semibold">{p.label}</span>{' '}
                  — {p.percent}% ({fmtMoney(p.amount)})
                  {p.due_date ? ` — ${p.due_date}` : ''}
                </li>
              ))}
            </ol>
            <p className="mb-3">
              All invoices shall be sent to Owner via e-mail at:{' '}
              <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com"
                className={inputCls} style={autoWidth(ownerEmail, 'owner@example.com', 22)} />
            </p>
            {clausePara('s7_payment_late', 'mb-3')}
          </Section>

          {/* ── §8 — Term ── */}
          <Section number="8" title="TERM.">
            <p className="mb-2">
              Contractor shall commence the Work on{' '}
              <input type="date" value={beginningDate} onChange={(e) => setBeginningDate(e.target.value)} className={inputCls} />
              {' '}and shall complete the work on or before{' '}
              <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} className={inputCls} />
              .
            </p>
            {clausePara('s8_term')}
          </Section>

          {/* ── §9 ── */}
          <Section number="9" title={clauseTitle('s9_unavoidable', 'UNAVOIDABLE DELAYS.')}>{clauseBody('s9_unavoidable')}</Section>

          <InitialsBox label="Owner Initials (Page 2):" value={ownerInitials} onChange={(e) => setOwnerInitials(e.target.value.toUpperCase().slice(0, 5))} />
          <div className="contract-pagebreak" />

          <Section number="10" title={clauseTitle('s10_insurance', 'INSURANCE.')}>{clauseBody('s10_insurance')}</Section>
          <Section number="11" title={clauseTitle('s11_access', 'FREE ACCESS TO WORKSITE.')}>{clauseBody('s11_access')}</Section>
          <Section number="12" title={clauseTitle('s12_photos', 'PHOTOGRAPHS AND MARKETING.')}>{clauseBody('s12_photos')}</Section>
          <Section number="13" title={clauseTitle('s13_utilities', 'UTILITIES.')}>{clauseBody('s13_utilities')}</Section>
          <Section number="14" title={clauseTitle('s14_inspection', 'INSPECTION.')}>{clauseBody('s14_inspection')}</Section>
          <Section number="15" title={clauseTitle('s15_default', 'DEFAULT.')}>{clauseBody('s15_default')}</Section>

          <InitialsBox label="Owner Initials (Page 3):" value={ownerInitials} onChange={(e) => setOwnerInitials(e.target.value.toUpperCase().slice(0, 5))} />
          <div className="contract-pagebreak" />

          <Section number="16" title={clauseTitle('s16_remedies', 'REMEDIES.')}>{clauseBody('s16_remedies')}</Section>
          <Section number="17" title={clauseTitle('s17_force', 'FORCE MAJEURE.')}>{clauseBody('s17_force')}</Section>
          <Section number="18" title={clauseTitle('s18_indemnity', 'INDEMNIFICATION and EXCLUSION OF CONSEQUENTIAL DAMAGES.')}>{clauseBody('s18_indemnity')}</Section>
          <Section number="19" title={clauseTitle('s19_severability', 'SEVERABILITY.')}>{clauseBody('s19_severability')}</Section>

          <InitialsBox label="Owner Initials (Page 4):" value={ownerInitials} onChange={(e) => setOwnerInitials(e.target.value.toUpperCase().slice(0, 5))} />
          <div className="contract-pagebreak" />

          <Section number="20" title={clauseTitle('s20_amendment', 'AMENDMENT.')}>{clauseBody('s20_amendment')}</Section>
          <Section number="21" title={clauseTitle('s21_governing', 'GOVERNING LAW.')}>{clauseBody('s21_governing')}</Section>
          <Section number="22" title={clauseTitle('s22_notice', 'NOTICE.')}>{clauseBody('s22_notice')}</Section>
          <Section number="23" title={clauseTitle('s23_no_waiver', 'NO WAIVER OF CONTRACTUAL RIGHT.')}>{clauseBody('s23_no_waiver')}</Section>
          <Section number="24" title={clauseTitle('s24_legal', 'LEGAL FEES and COSTS.')}>{clauseBody('s24_legal')}</Section>
          <Section number="25" title={clauseTitle('s25_entire', 'ENTIRE AGREEMENT.')}>{clauseBody('s25_entire')}</Section>
          <Section number="26" title={clauseTitle('s26_warranty', 'WARRANTY.')}>{clauseBody('s26_warranty')}</Section>

          <InitialsBox label="Owner Initials (Page 5):" value={ownerInitials} onChange={(e) => setOwnerInitials(e.target.value.toUpperCase().slice(0, 5))} />
          {/* ── Cancellation notice + signatures ── */}
          <div className="contract-pagebreak" />

          {/* Notice of the Customer's Right to Cancel — wrapped in a
              full-width table so DocuSign's HTML→PDF renderer can't
              collapse the paragraph into a narrow column on the right
              (which it kept doing with the previous div+text-center
              structure no matter how we forced width). The cell is
              guaranteed full-width by the parent table's width:100%. */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px', marginBottom: '28px' }}>
            <tbody>
              <tr>
                <td style={{ textAlign: 'center', padding: 0, background: 'transparent' }}>
                  <h2 className="text-[13px] font-black tracking-[0.12em] uppercase text-gray-900 mb-2" style={{ background: 'transparent' }}>
                    Notice of the Customer's Right to Cancel
                  </h2>
                  <div style={{ width: '40px', height: '2px', background: '#E8500A', margin: '0 auto 16px' }} />
                  <p className="italic text-[12px] text-gray-600 leading-relaxed" style={{ background: 'transparent', display: 'block', textAlign: 'center', margin: '0 auto', padding: '0 48px', maxWidth: '36rem' }}>
                    {CLAUSES.cancel_short}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>

          <p className="mb-10 text-[12.5px] text-gray-700">
            IN WITNESS WHEREOF, the parties hereto have executed this Agreement as of the date first written above.
          </p>

          {/* ── Signature block ──
              Originally a CSS-grid 2-col layout. DocuSign's HTML→PDF
              renderer doesn't reliably support CSS grid (the right
              column collapsed on top of the left or shrank to a sliver),
              so this is now a 2-cell table — same look on screen,
              works everywhere DocuSign is involved. The 32px padding
              on each cell side reproduces the original gap-16 (64px). */}
          <table className="mt-2 contract-signature" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                {/* Owner / Client side */}
                <td style={{ width: '50%', verticalAlign: 'top', paddingRight: '32px' }}>
              <p className="text-[9px] tracking-[0.3em] uppercase text-gray-400 font-semibold mb-4">
                Owner / Client
              </p>

              {/* Blank signature line — DocuSign places e-signature here */}
              {/* DocuSign anchor marker: the text 'sign_here_owner_anchor' is
                  rendered in white (invisible against the white page but
                  preserved in the PDF text layer) so DocuSign's anchor scanner
                  can find it. We pad it with leading underscores in case the
                  scanner trims punctuation — the unique core token survives.
                  color:transparent doesn't always make it into the text layer,
                  white-on-white reliably does. */}
              <div className="h-14 border-b-2 border-gray-300">
                <span style={{ color: '#ffffff', fontSize: '8px' }}>sign_here_owner_anchor</span>
              </div>
              <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-2">Signature</p>

              {/* Print name */}
              <div className="mt-6 border-b border-gray-200 pb-0.5 min-h-[22px]">
                <span className="text-[13px] text-gray-700 font-medium">
                  {ownerName || ' '}
                </span>
              </div>
              <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-1.5">Print Name</p>

              {/* Date — DocuSign auto-fills when owner signs */}
              <div className="mt-6">
                <div className="border-b-2 border-gray-300 h-7">
                  <span style={{ color: '#ffffff', fontSize: '8px' }}>sign_date_owner_anchor</span>
                </div>
                <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-2">Date</p>
              </div>
            </td>

                {/* Contractor side */}
                <td style={{ width: '50%', verticalAlign: 'top', paddingLeft: '32px' }}>
              <p className="text-[9px] tracking-[0.3em] uppercase text-gray-400 font-semibold mb-4">
                Omega Development LLC
              </p>

              {/* Pre-signed signature image — inline (no position:absolute)
                  because DocuSign's HTML→PDF renderer doesn't honor
                  absolute positioning reliably; the image was floating
                  free and overlapping the print-name text below it. */}
              <div className="border-b-2 border-gray-300" style={{ height: '56px', overflow: 'hidden' }}>
                <img
                  src="/inacio-signature.png"
                  alt="Inácio Oliveira signature"
                  style={{ display: 'block', height: '48px', maxWidth: '220px', marginTop: '4px', objectFit: 'contain' }}
                />
              </div>
              <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-2">Signature</p>

              {/* Print name */}
              <div className="mt-6 border-b border-gray-200 pb-0.5">
                <span className="text-[13px] text-gray-700 font-medium">Inácio Deoliveira</span>
              </div>
              <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-1.5">Print Name — Agent on behalf of Omega Development LLC</p>

              {/* Date */}
              <div className="mt-6">
                <div className="border-b-2 border-gray-300 pb-1">
                  <input
                    type="date"
                    value={contractorSignDate}
                    onChange={(e) => setContractorSignDate(e.target.value)}
                    className="w-full bg-transparent focus:outline-none text-[13px] text-gray-700"
                    style={{ backgroundColor: 'transparent' }}
                  />
                </div>
                <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-2">Date</p>
              </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── Schedule A ── */}
          <div className="contract-pagebreak" />

          <div className="text-center mb-8">
            <p className="text-[9px] tracking-[0.4em] text-omega-orange uppercase font-semibold mb-2">Exhibit</p>
            <h2 className="text-[20px] font-black tracking-[0.12em] uppercase text-gray-900 mb-1">
              Schedule A
            </h2>
            <p className="text-[9px] tracking-[0.25em] text-gray-400 uppercase mb-3">Description of Work</p>
            <div style={{ width: '40px', height: '2px', background: '#E8500A', margin: '0 auto' }} />
          </div>

          {schedule.length === 0 ? (
            <p className="italic text-gray-400 text-center py-8">
              No line items on the accepted estimate yet. Add items to the estimate and they will appear here.
            </p>
          ) : (
            <div className="space-y-5">
              {schedule.map((sec, si) => (
                <div key={si} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-5 py-2.5 border-b border-gray-100">
                    <h3 className="font-bold uppercase text-[10px] tracking-[0.15em] text-gray-500">
                      {sec.title}
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {sec.items.map((it, ii) => (
                      <div key={ii} className="px-5 py-3 grid grid-cols-[1fr_auto] gap-6 items-start">
                        <div>
                          <p className="font-semibold text-gray-900 text-[13px] leading-snug">
                            {it.description || '—'}
                          </p>
                          {it.scope && (
                            <p className="text-gray-500 text-[12px] whitespace-pre-line mt-1 leading-snug">
                              {it.scope}
                            </p>
                          )}
                        </div>
                        <div className="text-right tabular-nums font-semibold text-[13px] text-gray-900 min-w-[90px] pt-px">
                          {fmtMoney(it.price)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Total row */}
              <div className="flex items-center justify-between px-5 py-4 rounded-xl mt-2"
                style={{ background: '#1a1a1a' }}>
                <p className="font-bold uppercase text-[10px] tracking-[0.18em] text-white">
                  Total Contract Value
                </p>
                <p className="font-black tabular-nums text-[15px] text-white">
                  {fmtMoney(totalAmount)}
                </p>
              </div>
            </div>
          )}

          {/* ── Notice of Cancellation ── */}
          <div className="contract-pagebreak" />

          <div className="text-center mt-4 mb-6">
            <h2 className="text-[13px] font-black tracking-[0.12em] uppercase text-gray-900 mb-2">
              Notice of Cancellation
            </h2>
            <div style={{ width: '40px', height: '2px', background: '#E8500A', margin: '0 auto' }} />
          </div>

          <p className="text-center text-[12px] text-gray-600 mb-6">
            (Date of Transaction: _________________________________ )
          </p>

          <p className="font-bold whitespace-pre-line mb-6 text-[12px] leading-relaxed">
            {CLAUSES.cancel_full}
          </p>

          <p className="text-center italic text-[12px] text-gray-600 mb-2">
            I HEREBY CANCEL THIS TRANSACTION.
          </p>

          <div className="grid grid-cols-[3fr_1fr] gap-6 mt-12">
            <div>
              <div className="border-b-2 border-gray-300 h-10" />
              <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-2 text-center">Signed</p>
            </div>
            <div>
              <div className="border-b-2 border-gray-300 h-10" />
              <p className="text-[9px] tracking-[0.18em] uppercase text-gray-400 mt-2 text-center">Date</p>
            </div>
          </div>

        </div>{/* /inner padding */}
      </div>{/* /document */}

      {/* ───────────────────── ACTION BAR ───────────────────── */}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {pdfError && (
          <p className="text-xs text-red-600 mr-auto">{pdfError}</p>
        )}
        <button
          onClick={downloadPDF}
          disabled={pdfDownloading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal disabled:opacity-50 transition"
        >
          {pdfDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {pdfDownloading ? 'Generating…' : 'Download PDF'}
        </button>
        <button
          onClick={handleSendDocuSignClick}
          disabled={!canSendDocuSign || saving}
          title={canSendDocuSign ? 'Send for e-signature via DocuSign' : 'DocuSign not configured yet — use Download PDF'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {canSendDocuSign ? <Send className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {saving ? 'Sending…' : 'Send via DocuSign'}
        </button>
      </div>

      {/* Style overrides:
          • inputs grow with content (no fixed height) — long addresses/emails
            are never clipped, on screen or in the PDF
          • paragraphs get orphans/widows so a single line is never stranded
            at a page boundary
          • contract-pagebreak markers are invisible on screen; their
            page-break CSS is applied dynamically only during PDF export */}
      <style>{`
        .contract-doc input,
        .contract-doc textarea {
          font: inherit;
          color: inherit;
          background-color: #fef08a;
          vertical-align: baseline;
          padding-top: 1px;
          padding-bottom: 1px;
          line-height: 1.4;
        }
        .contract-doc input[type="date"] {
          line-height: 1;
        }
        .contract-doc p {
          orphans: 3;
          widows: 3;
        }
        .contract-doc .contract-pagebreak {
          height: 0;
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: transparent;
        }
      `}</style>
    </div>
  );
}

// ─── Auto-growing textarea (clause edit mode) ────────────────────────
// Module-level so React keeps the element identity stable across
// renders — defining it inside ContractTemplate would remount the
// textarea on every keystroke and drop focus.
function AutoGrowTextarea({ value, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      spellCheck={false}
      className="w-full px-2 py-1.5 border border-amber-300 rounded-lg text-[12.5px] leading-relaxed text-gray-700 focus:outline-none focus:border-omega-orange resize-none"
      style={{ overflow: 'hidden' }}
    />
  );
}

// ─── Initials box ────────────────────────────────────────────────────
// Rendered at the bottom of each important page (before a page break).
// All 4 boxes share a single state so Brenda fills in once on screen.
// DocuSign will generate independent initials tabs per page requiring
// the client to initial each one separately.
function InitialsBox({ label, value, onChange }) {
  // Right-aligned via text-align rather than flex justify-end so the
  // serialized contract still renders correctly under DocuSign's
  // HTML→PDF renderer (which doesn't reliably honor flex).
  return (
    <div className="text-right mt-5 pt-4 border-t border-gray-100 contract-initials">
      <span className="text-[9px] tracking-[0.25em] uppercase text-gray-400 font-semibold mr-3 align-middle">
        {label}
      </span>
      <input
        value={value}
        onChange={onChange}
        maxLength={5}
        placeholder="___"
        className="w-16 text-center border-b-2 border-gray-500 bg-transparent focus:outline-none focus:border-omega-orange text-[15px] font-bold uppercase pb-0.5 tracking-widest align-middle"
      />
    </div>
  );
}

// ─── Section helper ──────────────────────────────────────────────────
// Premium numbered clause block. Number in orange, title uppercase with
// tracking, body text in a separate block below (not inline) so inputs
// inside the body align correctly against their underlines.
function Section({ number, title, children }) {
  // Inline-block + margin instead of flex+gap: DocuSign's HTML→PDF
  // renderer doesn't reliably honor flexbox `gap`, which collapsed the
  // 8px space between number and title (rendered as "01.DESCRIPTION OF
  // SERVICES" with no breath). Inline-block always works.
  return (
    <div className="mb-5 contract-section">
      <div className="mb-1.5 contract-section-title">
        <span className="text-omega-orange font-black text-[11px] leading-none tabular-nums inline-block mr-2 align-baseline">
          {String(number).padStart(2, '0')}.
        </span>
        <span className="font-bold text-[11px] uppercase tracking-[0.08em] text-gray-900 leading-tight inline-block align-baseline">
          {title}
        </span>
      </div>
      <div className="pl-7 text-[12.5px] leading-relaxed text-gray-700">
        {typeof children === 'string'
          ? <span className="whitespace-pre-line">{children}</span>
          : children}
      </div>
    </div>
  );
}
