import LegalPage, { H2, P, UL } from './LegalPage';

// Privacy Policy — covers the disclosures Twilio / carriers require for
// A2P 10DLC campaign approval: who we are, what we collect, how it's
// used, non-sharing for marketing, opt-out, SMS-specific notice.
export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy" updated="April 24, 2026">
      <P>
        Omega Development LLC (&ldquo;Omega Development&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) is a
        construction and renovation company headquartered in Fairfield County,
        Connecticut. This Privacy Policy explains what information we collect
        from our customers and prospective customers, how we use it, and the
        choices you have about that information.
      </P>

      <H2>1. Information we collect</H2>
      <P>
        We collect only the information we need to quote, schedule, deliver and
        service your construction project. This includes:
      </P>
      <UL>
        <li>Your name, phone number, email address, and the address of the property where work will be performed.</li>
        <li>Details you share about the project you are considering (service type, scope, timeline, budget notes).</li>
        <li>Photos or documents you voluntarily send us during the estimating or construction process.</li>
        <li>Records of the work we perform, invoices, payments and signed contracts.</li>
      </UL>

      <H2>2. How we use your information</H2>
      <P>We use the information you provide solely to operate our business with you:</P>
      <UL>
        <li>Contact you about your project — appointment confirmations, estimate updates, job status, reschedule notices, and payment reminders.</li>
        <li>Prepare and deliver estimates and contracts.</li>
        <li>Coordinate our field team, subcontractors and material orders for your job.</li>
        <li>Provide warranty follow-up and respond to service requests after a job is completed.</li>
        <li>Meet our legal, accounting and insurance obligations.</li>
      </UL>

      <H2>3. SMS / text messages</H2>
      <P>
        When you provide your phone number to Omega Development — in person at
        our office, during an inbound phone call, or by filling out a lead form
        on our website — you authorize us to send you transactional SMS messages
        related to your construction project. These include appointment
        confirmations, estimate updates, job status updates, reschedule notices,
        and payment reminders.
      </P>
      <P>
        <strong>Message frequency varies</strong> by project stage.
        <strong> Message and data rates may apply.</strong>
        You can opt out at any time by replying <strong>STOP</strong> to any
        message, or reply <strong>HELP</strong> for assistance. We do not use
        SMS for marketing or promotional messages, and we do not share your
        phone number or SMS opt-in status with third parties for their own
        marketing purposes. No mobile information will be shared with third
        parties or affiliates for marketing or promotional purposes.
      </P>

      <H2>4. How we share your information</H2>
      <P>
        We do <strong>not</strong> sell your personal information. We do not
        share it with third parties for their marketing or promotional use.
        We share limited information only with:
      </P>
      <UL>
        <li>Subcontractors and field crew we assign to your project, so they can show up at the right address at the right time.</li>
        <li>Service providers we use to run the business — for example, electronic signature services (DocuSign), SMS delivery (Twilio), email delivery, payment processors, cloud hosting, and accounting software. These providers handle your information only to perform services for us and are contractually required to protect it.</li>
        <li>Government authorities, inspectors, or our insurers when required by law, regulation, permit, or legal process.</li>
      </UL>

      <H2>5. Data retention</H2>
      <P>
        We keep project records (estimates, contracts, job photos, invoices,
        payments) for as long as needed to service your project and to meet our
        tax, warranty and legal obligations. You can ask us to delete
        information that is not required for those purposes by contacting us
        at the address below.
      </P>

      <H2>6. Your choices</H2>
      <UL>
        <li><strong>SMS opt-out:</strong> Reply STOP to any text message we send.</li>
        <li><strong>Email opt-out:</strong> Reply to any email and ask to be removed, or use the unsubscribe link when present.</li>
        <li><strong>Access or correction:</strong> Contact us to review or correct the information we hold about you.</li>
      </UL>

      <H2>7. Security</H2>
      <P>
        We use reasonable physical, administrative and technical safeguards to
        protect the information you give us. No system is perfectly secure, so
        if you believe your information has been compromised, please contact us
        immediately.
      </P>

      <H2>8. Children&rsquo;s privacy</H2>
      <P>
        Our services are directed to property owners and are not intended for
        children under 13. We do not knowingly collect information from
        children.
      </P>

      <H2>9. Changes to this policy</H2>
      <P>
        We may update this Privacy Policy from time to time. The &ldquo;Last
        updated&rdquo; date at the bottom of the page reflects the most recent
        version. Significant changes will be communicated through the contact
        method we have on file for you.
      </P>

      <H2>10. Contact us</H2>
      <P>
        Questions about this Privacy Policy or about information we hold about
        you:
      </P>
      <P>
        Omega Development LLC<br />
        Fairfield County, Connecticut<br />
        Email: <a className="text-omega-orange underline" href="mailto:contact@omegadevelopment.com">contact@omegadevelopment.com</a><br />
        Phone: 203-451-4846
      </P>
    </LegalPage>
  );
}
