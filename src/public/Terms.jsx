import LegalPage, { H2, P, UL } from './LegalPage';

// Terms & Conditions — structured to include every disclosure Twilio
// demands in the SMS block: Program name, description, frequency,
// STOP / HELP keywords, message & data rates, and support contact.
export default function Terms() {
  return (
    <LegalPage title="Terms & Conditions" updated="April 24, 2026">

      <P>
        These Terms &amp; Conditions govern your use of Omega Development
        LLC&rsquo;s services and communications, including the SMS program
        described below. By engaging our services or providing your phone
        number to us, you agree to these terms.
      </P>

      {/* ─── The SMS-specific block Twilio reviews in detail ─── */}
      <H2>SMS Terms of Service — Omega Development SMS</H2>

      <P>
        <strong>Program name:</strong> Omega Development SMS
      </P>
      <P>
        <strong>Program description:</strong> Transactional SMS messages from
        Omega Development LLC to our customers and prospective customers
        regarding their construction project — appointment confirmations,
        estimate updates, job status, reschedule notices, and payment
        reminders.
      </P>
      <P>
        <strong>Message frequency:</strong> Message frequency varies based on
        your project stage. You may receive several messages in a busy week
        (for example, during active construction) and none in a quiet week.
      </P>
      <P>
        <strong>Message and data rates:</strong> Message and data rates may
        apply depending on your mobile carrier and plan.
      </P>
      <P>
        <strong>Opt-out:</strong> You can cancel the SMS service at any time.
        Reply <strong>STOP</strong> to any message from us. You will receive a
        final confirmation message and no further messages will be sent. If
        you want to resubscribe later, reply <strong>START</strong>, contact
        our office, or ask any Omega Development team member to re-enable SMS.
      </P>
      <P>
        <strong>Help:</strong> If you need help or have questions at any time,
        reply <strong>HELP</strong> to any of our messages. You can also
        contact customer support directly using the information below.
      </P>
      <P>
        <strong>Support contact:</strong> Email{' '}
        <a className="text-omega-orange underline" href="mailto:contact@omegadevelopment.com">contact@omegadevelopment.com</a>{' '}
        or call 203-451-4846 during business hours.
      </P>
      <P>
        <strong>Carriers:</strong> Carriers are not liable for delayed or
        undelivered messages.
      </P>
      <P>
        <strong>Privacy:</strong> See our{' '}
        <a className="text-omega-orange underline" href="/privacy">Privacy Policy</a>{' '}
        for details on how we handle the information you give us, including
        your phone number. No mobile information will be shared with third
        parties or affiliates for marketing or promotional purposes.
      </P>

      {/* ─── General Terms ─── */}
      <H2>General Terms</H2>

      <H2>1. Services</H2>
      <P>
        Omega Development LLC provides construction, renovation and related
        services in Fairfield County, Connecticut and the surrounding area.
        Every project we undertake is governed by a separate signed contract
        or estimate approved by the customer. These Terms do not replace a
        signed project contract — they supplement it.
      </P>

      <H2>2. Estimates</H2>
      <P>
        Estimates are valid for 30 days unless stated otherwise on the
        estimate itself. Material and labor pricing may change after that
        window. An estimate is not a binding contract until it is signed by
        both parties.
      </P>

      <H2>3. Payments</H2>
      <P>
        Payment schedules are set on a per-project basis and described in the
        signed contract. Late payments may delay work and are subject to any
        late fees allowed by Connecticut law and stated in the contract.
      </P>

      <H2>4. Communications</H2>
      <P>
        By providing your phone number or email address to Omega Development
        LLC, you consent to receive service-related communications from us
        about your project. You can opt out of SMS at any time by replying
        STOP. Opting out of SMS does not opt you out of necessary
        project-related calls or emails — we will still contact you about
        your active job through other channels.
      </P>

      <H2>5. Property access</H2>
      <P>
        For scheduled work, you agree to provide reasonable access to the
        property at the agreed date and time, or to notify us in advance if
        rescheduling is needed. Repeated cancellations may result in
        rescheduling fees per the signed project contract.
      </P>

      <H2>6. Warranty</H2>
      <P>
        Warranty terms are specified in each signed project contract.
        Manufacturer warranties for installed products and materials are
        passed through to the customer and are governed by the
        manufacturer&rsquo;s terms.
      </P>

      <H2>7. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by Connecticut law, Omega Development
        LLC&rsquo;s liability for any claim arising from our services is
        limited to the amount actually paid by the customer under the
        specific project contract giving rise to the claim.
      </P>

      <H2>8. Governing law</H2>
      <P>
        These Terms are governed by the laws of the State of Connecticut.
        Any dispute will be brought exclusively in the state or federal
        courts located in Fairfield County, Connecticut.
      </P>

      <H2>9. Changes</H2>
      <P>
        We may update these Terms from time to time. The &ldquo;Last
        updated&rdquo; date at the bottom of the page reflects the most
        recent version. Continued use of our services after changes
        constitutes acceptance of the updated Terms.
      </P>

      <H2>10. Contact</H2>
      <P>
        Omega Development LLC<br />
        Fairfield County, Connecticut<br />
        Email: <a className="text-omega-orange underline" href="mailto:contact@omegadevelopment.com">contact@omegadevelopment.com</a><br />
        Phone: 203-451-4846
      </P>
    </LegalPage>
  );
}
