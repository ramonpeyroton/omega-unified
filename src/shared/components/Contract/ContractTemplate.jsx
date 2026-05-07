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

import { useMemo, useRef, useState } from 'react';
import { Download, Loader2, Send, Lock } from 'lucide-react';

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
  cancel_short: `Owner may cancel this transaction at any time prior to midnight on the third business day after the date of this transaction. SEE THE ATTACHED NOTICE OF CANCELLATION FOR AN EXPLANATION OF THIS RIGHT. NOTE: Saturday is a legal business day in Connecticut.`,
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

  const schedule = useMemo(() => readScheduleA(estimate), [estimate]);
  const totalAmount = useMemo(() => {
    if (estimate?.total_amount) return Number(estimate.total_amount);
    return schedule.reduce((acc, s) =>
      acc + s.items.reduce((sum, it) => sum + (it.price || 0), 0), 0);
  }, [estimate, schedule]);

  async function downloadPDF() {
    if (!docRef.current) return;
    setPdfDownloading(true);
    setPdfError('');
    // Remove yellow highlight before capturing — inputs get transparent bg so
    // the PDF looks clean. Restored in finally so the screen still shows yellow.
    const highlighted = Array.from(docRef.current.querySelectorAll('input, textarea'));
    highlighted.forEach((el) => (el.style.backgroundColor = 'transparent'));
    try {
      // Dynamic import keeps html2pdf out of the main bundle until
      // someone actually clicks the button.
      const html2pdfMod = await import('html2pdf.js');
      const html2pdf = html2pdfMod.default || html2pdfMod;
      const filename = `omega-contract-${(ownerName || 'client').replace(/[^a-z0-9-]/gi, '_').slice(0, 40)}-${todayIso()}.pdf`;
      await html2pdf()
        .set({
          margin: [0.6, 0.6, 0.7, 0.6], // inches
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], before: '.contract-pagebreak' },
        })
        .from(docRef.current)
        .save();
    } catch (err) {
      setPdfError(err?.message || 'Could not generate the PDF.');
    } finally {
      highlighted.forEach((el) => (el.style.backgroundColor = ''));
      setPdfDownloading(false);
    }
  }

  const [contractorSignDate, setContractorSignDate] = useState(todayIso());

  // Editable input style — flat, underlined, blends with the printed
  // contract so PDF output looks like a typed form.
  const inputCls = 'inline-block min-w-[120px] px-1 py-0.5 border-b border-omega-charcoal/60 bg-transparent focus:outline-none focus:border-omega-orange print:border-b-black';
  const numCls   = `${inputCls} text-right tabular-nums`;
  const blockCls = 'w-full px-2 py-1 mt-1 border border-gray-200 rounded bg-white focus:outline-none focus:border-omega-orange print:border-0';

  // Derived display
  const planRows = (paymentPlan || []).map((p, i) => ({
    label: p.label || `Payment ${i + 1}`,
    percent: Number(p.percent) || 0,
    amount: Number(p.amount) || (totalAmount ? totalAmount * (Number(p.percent) / 100) : 0),
    due_date: p.due_date || '',
  }));

  return (
    <div>
      {/* ───────────────────── DOCUMENT BODY ───────────────────── */}
      <div
        ref={docRef}
        className="bg-white border border-gray-200 rounded-xl p-8 sm:p-10 shadow-card text-[13px] leading-relaxed text-omega-charcoal contract-doc"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        {/* Title */}
        <h1 className="text-center font-bold text-base underline mb-6">
          CONSTRUCTION CONTRACT
        </h1>

        {/* Opening paragraph */}
        <p className="mb-3">
          This Construction Contract (the "Contract" or "Agreement") is made as of{' '}
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputCls} />
          {' '}(the "Effective Date") by and between{' '}
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner full name" className={inputCls} />
          {' '}of address{' '}
          <input value={ownerAddress} onChange={(e) => setOwnerAddress(e.target.value)} placeholder="Owner address" className={inputCls} />
          {' '}(hereinafter referred to "Owner") and OMEGA DEVELOPMENT LLC (hereinafter referred to as "Contractor")
          Registration numbers: HIC.0670573 and NHC.0017262.
        </p>
        <p className="mb-4">
          In consideration of the mutual promises set forth below, the parties agree to the following terms and conditions:
        </p>

        {/* §1 */}
        <Section number="1" title="DESCRIPTION OF SERVICES.">
          Beginning on{' '}
          <input type="date" value={beginningDate} onChange={(e) => setBeginningDate(e.target.value)} className={inputCls} />
          , Contractor will provide to owner the services described in the attached SCHEDULE A
          (collectively, the "Work" Estimate.)
        </Section>

        {/* §2 */}
        <Section number="2" title="SCOPE OF WORK.">
          {CLAUSES.s2_scope.replace('__ADDRESS__', propertyAddress || '___')}
        </Section>

        {/* §3-5 */}
        <Section number="3" title="PLANS, SPECIFICATIONS AND CONSTRUCTION DOCUMENTS.">
          {CLAUSES.s3_plans}
        </Section>
        <Section number="4" title="WORK SITE.">
          {CLAUSES.s4_site}
        </Section>
        <Section number="5" title="PERMITS.">
          {CLAUSES.s5_permits}
        </Section>
        <Section number="6" title="MATERIALS AND/OR LABOR">
          Refer to Schedule A.
        </Section>

        {/* Page break before the payment schedule so the PDF page 2 lines up
            with the original layout. */}
        <div className="contract-pagebreak" />

        {/* §7 — Payment Schedule */}
        <Section number="7" title="PAYMENT SCHEDULE.">
          <p className="mb-2">
            Owner agrees to pay Contractor the total sum of{' '}
            <span className="font-bold">{fmtMoney(totalAmount)}</span>.
          </p>
          <p className="mb-3">{CLAUSES.s7_payment_intro}</p>
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
            <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com" className={inputCls} />
          </p>
          <p className="mb-3 whitespace-pre-line">{CLAUSES.s7_payment_late}</p>
        </Section>

        {/* §8 — Term */}
        <Section number="8" title="TERM.">
          <p className="mb-2">
            Contractor shall commence the Work on{' '}
            <input type="date" value={beginningDate} onChange={(e) => setBeginningDate(e.target.value)} className={inputCls} />
            {' '}and shall complete the work on or before{' '}
            <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} className={inputCls} />
            .
          </p>
          <p className="whitespace-pre-line">{CLAUSES.s8_term}</p>
        </Section>

        {/* §9-25 — fixed legal text */}
        <Section number="9" title="UNAVOIDABLE DELAYS.">{CLAUSES.s9_unavoidable}</Section>

        <div className="contract-pagebreak" />

        <Section number="10" title="INSURANCE.">{CLAUSES.s10_insurance}</Section>
        <Section number="11" title="FREE ACCESS TO WORKSITE.">{CLAUSES.s11_access}</Section>
        <Section number="12" title="PHOTOGRAPHS AND MARKETING.">{CLAUSES.s12_photos}</Section>
        <Section number="13" title="UTILITIES.">{CLAUSES.s13_utilities}</Section>
        <Section number="14" title="INSPECTION.">{CLAUSES.s14_inspection}</Section>
        <Section number="15" title="DEFAULT.">{CLAUSES.s15_default}</Section>

        <div className="contract-pagebreak" />

        <Section number="16" title="REMEDIES.">{CLAUSES.s16_remedies}</Section>
        <Section number="17" title="FORCE MAJEURE.">{CLAUSES.s17_force}</Section>
        <Section number="18" title="INDEMNIFICATION and EXCLUSION OF CONSEQUENTIAL DAMAGES.">{CLAUSES.s18_indemnity}</Section>
        <Section number="19" title="SEVERABILITY.">{CLAUSES.s19_severability}</Section>

        <div className="contract-pagebreak" />

        <Section number="20" title="AMENDMENT.">{CLAUSES.s20_amendment}</Section>
        <Section number="21" title="GOVERNING LAW.">{CLAUSES.s21_governing}</Section>
        <Section number="22" title="NOTICE.">{CLAUSES.s22_notice}</Section>
        <Section number="23" title="NO WAIVER OF CONTRACTUAL RIGHT.">{CLAUSES.s23_no_waiver}</Section>
        <Section number="24" title="LEGAL FEES and COSTS.">{CLAUSES.s24_legal}</Section>
        <Section number="25" title="ENTIRE AGREEMENT.">{CLAUSES.s25_entire}</Section>

        {/* Cancellation notice + signatures */}
        <div className="contract-pagebreak" />

        <h2 className="text-center font-bold underline my-4">
          NOTICE OF THE CUSTOMER'S RIGHT TO CANCEL
        </h2>
        <p className="text-center italic mb-6">
          {CLAUSES.cancel_short}
        </p>
        <p className="mb-8">
          IN WITNESS WHEREOF, the parties hereto have executed this Agreement as of the date first written above.
        </p>

        <div className="grid grid-cols-2 gap-12 mt-12">
          {/* Owner / Client side */}
          <div>
            <div className="border-b border-omega-charcoal h-10 flex items-end pb-1">
              {ownerName && (
                <span className="text-[13px] font-semibold uppercase tracking-wide">
                  {ownerName}
                </span>
              )}
            </div>
            <p className="text-xs mt-1">OWNER</p>
            <div className="border-b border-omega-charcoal mt-8 flex items-end pb-0.5">
              <input
                type="date"
                className={`${inputCls} w-full`}
                placeholder="mm/dd/yyyy"
              />
            </div>
            <p className="text-xs mt-1">DATE</p>
          </div>
          {/* Contractor side */}
          <div>
            <div className="relative border-b border-omega-charcoal h-16">
              <img
                src="/inacio-signature.png"
                alt="Inácio Oliveira signature"
                className="absolute bottom-1 left-0 h-14 w-auto object-contain"
              />
            </div>
            <p className="text-xs mt-1">Agent on behalf of Omega Development LLC</p>
            <div className="border-b border-omega-charcoal mt-8 flex items-end pb-0.5">
              <input
                type="date"
                value={contractorSignDate}
                onChange={(e) => setContractorSignDate(e.target.value)}
                className={`${inputCls} w-full`}
              />
            </div>
            <p className="text-xs mt-1">DATE</p>
          </div>
        </div>

        {/* SCHEDULE A */}
        <div className="contract-pagebreak" />
        <h2 className="text-center font-bold underline my-4">
          SCHEDULE A — DESCRIPTION OF WORK
        </h2>
        {schedule.length === 0 ? (
          <p className="italic text-omega-stone">
            No line items on the accepted estimate yet. Add items to the estimate and they will appear here.
          </p>
        ) : (
          <div className="space-y-5">
            {schedule.map((sec, si) => (
              <div key={si}>
                <h3 className="font-bold uppercase text-[12px] tracking-wide border-b border-gray-300 pb-1 mb-2">
                  {sec.title}
                </h3>
                <ul className="space-y-3">
                  {sec.items.map((it, ii) => (
                    <li key={ii} className="grid grid-cols-[1fr_auto] gap-4">
                      <div>
                        <p className="font-semibold">{it.description || '—'}</p>
                        {it.scope && (
                          <p className="text-omega-stone whitespace-pre-line text-[12px]">{it.scope}</p>
                        )}
                      </div>
                      <div className="text-right tabular-nums font-semibold">
                        {fmtMoney(it.price)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] gap-4 pt-3 border-t-2 border-omega-charcoal">
              <p className="font-bold uppercase text-sm">Total</p>
              <p className="font-bold tabular-nums text-sm">{fmtMoney(totalAmount)}</p>
            </div>
          </div>
        )}

        {/* Notice of Cancellation — final standalone page */}
        <div className="contract-pagebreak" />
        <h2 className="text-center font-bold underline my-4">NOTICE OF CANCELLATION</h2>
        <p className="text-center mb-4">
          (Date of Transaction: _________________________________ )
        </p>
        <p className="font-bold whitespace-pre-line mb-4">{CLAUSES.cancel_full}</p>
        <p className="text-center italic mb-2">I HEREBY CANCEL THIS TRANSACTION.</p>
        <div className="grid grid-cols-[3fr_1fr] gap-6 mt-12">
          <div>
            <div className="border-b border-omega-charcoal h-10" />
            <p className="text-xs mt-1 text-center">Signed</p>
          </div>
          <div>
            <div className="border-b border-omega-charcoal h-10" />
            <p className="text-xs mt-1 text-center">Date</p>
          </div>
        </div>
      </div>

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
          onClick={onSendDocuSign}
          disabled={!canSendDocuSign || saving}
          title={canSendDocuSign ? 'Send for e-signature via DocuSign' : 'DocuSign not configured yet — use Download PDF'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {canSendDocuSign ? <Send className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {saving ? 'Sending…' : 'Send via DocuSign'}
        </button>
      </div>

      {/* Print/PDF rules — used by html2pdf so the editable inputs render
          as plain text-on-line in the exported document. */}
      <style>{`
        .contract-doc input,
        .contract-doc textarea {
          font: inherit;
          color: inherit;
          background-color: #fef08a;
        }
        .contract-doc .contract-pagebreak {
          break-before: page;
          page-break-before: always;
          height: 0;
        }
      `}</style>
    </div>
  );
}

// ─── Section helper ──────────────────────────────────────────────────
// Numbered, bold-headed clause block. children can be plain text or any
// React node (we sometimes inline inputs inside the body).
function Section({ number, title, children }) {
  return (
    <div className="mb-4">
      <p className="mb-1">
        <span className="font-bold">{number}.</span>{' '}
        <span className="font-bold">{title}</span>
        {typeof children === 'string' && children.startsWith(' ')
          ? children
          : <> </>}
        {typeof children === 'string'
          ? <span className="whitespace-pre-line">{children}</span>
          : children}
      </p>
    </div>
  );
}
