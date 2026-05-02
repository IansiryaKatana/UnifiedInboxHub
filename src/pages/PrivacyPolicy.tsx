import { useEffect } from "react";
import { LegalPageLayout } from "@/components/LegalPageLayout";

export default function PrivacyPolicy() {
  useEffect(() => {
    document.title = "Privacy Policy — Unified Inbox Hub";
  }, []);

  return (
    <LegalPageLayout title="Privacy Policy">
      <p className="lead text-neutral-600 not-prose text-base">
        Last updated: May 2, 2026 · Website:{" "}
        <a href="https://unifiedinboxhub.com/">https://unifiedinboxhub.com/</a>
      </p>

      <p>
        Unified Inbox Hub (“we,” “us,” or “our”) respects your privacy. This Privacy Policy describes how we collect,
        use, disclose, and safeguard information when you use our web application and related services (the
        “Service”) at unifiedinboxhub.com. By using the Service, you agree to this Privacy Policy. If you do not
        agree, please do not use the Service.
      </p>

      <h2>1. Scope</h2>
      <p>
        This policy applies to information processed through the Service, including when you create an account,
        connect email accounts, send or receive messages through the Service, enable notifications, or interact
        with our website.
      </p>

      <h2>2. Information we collect</h2>
      <h3>2.1 Account and authentication data</h3>
      <p>When you register or sign in, we may process:</p>
      <ul>
        <li>Email address and authentication identifiers issued by our identity provider</li>
        <li>Profile details you provide (for example, display name)</li>
        <li>Credentials and tokens necessary to maintain your session securely</li>
        <li>
          If you use Google or similar OAuth providers, we receive information from that provider as permitted by
          your authorization settings and the provider’s policies
        </li>
      </ul>

      <h3>2.2 Email and communications content</h3>
      <p>
        The Service is designed to consolidate email and related communications that you choose to connect. Depending
        on how you connect accounts and how synchronization is configured, this may include message metadata (such as
        subject lines, sender and recipient addresses, timestamps, and folder or label information) and message content
        (including bodies and attachments) needed to display threads, search, compose, and send mail through the
        Service.
      </p>

      <h3>2.3 Technical and usage data</h3>
      <p>We may collect:</p>
      <ul>
        <li>Device and browser type, operating system, and general geographic region derived from network information</li>
        <li>Log data such as IP address, access times, pages or features used, and diagnostic events</li>
        <li>Error reports and performance metrics that help us operate and improve the Service</li>
      </ul>

      <h3>2.4 Push notifications</h3>
      <p>
        If you opt in to browser push notifications, we store the subscription details required to deliver alerts to
        your device (for example, endpoint and cryptographic keys provided by the push platform). You can revoke
        notifications at any time through your browser or device settings and through any in-app controls we provide.
      </p>

      <h2>3. How we use information</h2>
      <p>We use information to:</p>
      <ul>
        <li>Provide, operate, and maintain the Service, including inbox aggregation, sync, search, and compose features</li>
        <li>Authenticate users, prevent fraud and abuse, and protect account security</li>
        <li>Deliver notifications you request (such as new-message alerts)</li>
        <li>Improve reliability, performance, and user experience</li>
        <li>Comply with legal obligations and enforce our Terms of Service</li>
        <li>Communicate about the Service, including security notices and policy updates when appropriate</li>
      </ul>

      <h2>4. Legal bases (EEA, UK, and similar regions)</h2>
      <p>
        Where applicable privacy laws require a legal basis, we rely on one or more of the following: performance of a
        contract with you; legitimate interests that are not overridden by your rights (such as securing the Service
        and preventing misuse); your consent where required (for example, certain notifications or optional
        processing); and compliance with legal obligations.
      </p>

      <h2>5. How we share information</h2>
      <p>
        We do not sell your personal information. We may share information only as described in this policy or as
        permitted by law:
      </p>
      <ul>
        <li>
          <strong>Service providers.</strong> We use trusted vendors to host infrastructure, authenticate users, store
          data, deliver email and notifications, and support operations. These providers process information on our
          instructions and under contractual safeguards appropriate to the sensitivity of the data.
        </li>
        <li>
          <strong>Email and identity providers.</strong> Connecting third-party mail or OAuth providers necessarily
          involves sharing information with those providers according to their terms and your account settings.
        </li>
        <li>
          <strong>Legal and safety.</strong> We may disclose information if we believe it is necessary to comply with
          law, enforce our policies, protect users, or address fraud or security issues.
        </li>
        <li>
          <strong>Business transfers.</strong> If we are involved in a merger, acquisition, or asset sale, information
          may be transferred as part of that transaction, subject to appropriate confidentiality and notice
          obligations.
        </li>
      </ul>

      <h2>6. Retention</h2>
      <p>
        We retain information for as long as your account is active and as needed to provide the Service. We may
        retain certain records longer where required for security, legal compliance, dispute resolution, or legitimate
        business needs. Retention periods vary based on the type of data and context; when data is no longer needed,
        we delete or de-identify it in line with our procedures and applicable law.
      </p>

      <h2>7. Security</h2>
      <p>
        We implement administrative, technical, and organizational measures designed to protect information, including
        encryption in transit (such as TLS) and access controls aligned with the sensitivity of email data. No method
        of transmission or storage is completely secure; we encourage strong passwords, device security, and cautious
        connection of third-party accounts.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Our infrastructure and subprocessors may be located in countries other than your own. Where we transfer
        personal data across borders, we use appropriate safeguards such as standard contractual clauses or other
        mechanisms required by applicable law.
      </p>

      <h2>9. Your rights and choices</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or restrict processing of your
        personal data, to object to certain processing, to data portability, or to withdraw consent where processing
        is consent-based. You may also have the right to lodge a complaint with a supervisory authority. To exercise
        these rights, contact us using the details below. We will respond in accordance with applicable law.
      </p>

      <h2>10. Children’s privacy</h2>
      <p>
        The Service is not directed to children under 16 (or the minimum age required in your jurisdiction). We do not
        knowingly collect personal information from children. If you believe we have collected such information,
        contact us and we will take appropriate steps to delete it.
      </p>

      <h2>11. Third-party services</h2>
      <p>
        The Service may contain links to third-party sites or integrate with external providers. Their collection and
        use of information is governed by their own policies. We encourage you to review those policies when you
        connect accounts or follow links.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will post the revised policy on this page and update
        the “Last updated” date. For material changes, we may provide additional notice (such as an in-app message or
        email) where appropriate. Continued use of the Service after changes constitutes acceptance of the updated
        policy, subject to applicable law.
      </p>

      <h2>13. Contact</h2>
      <p>
        For privacy-related requests or questions about this policy, contact us at{" "}
        <a href="mailto:privacy@unifiedinboxhub.com">privacy@unifiedinboxhub.com</a> or write to us through the contact
        options published at{" "}
        <a href="https://unifiedinboxhub.com/">https://unifiedinboxhub.com/</a>.
      </p>

      <p className="text-sm text-neutral-600 not-prose border-t border-neutral-200 pt-6 mt-8">
        This Privacy Policy is provided for transparency and operational purposes. It does not constitute legal advice.
        You may wish to consult qualified counsel regarding your specific situation or jurisdiction.
      </p>
    </LegalPageLayout>
  );
}
