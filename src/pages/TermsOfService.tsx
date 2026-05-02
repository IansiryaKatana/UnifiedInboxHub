import { useEffect } from "react";
import { LegalPageLayout } from "@/components/LegalPageLayout";

export default function TermsOfService() {
  useEffect(() => {
    document.title = "Terms of Service — Unified Inbox Hub";
  }, []);

  return (
    <LegalPageLayout title="Terms of Service">
      <p className="lead text-neutral-600 not-prose text-base">
        Last updated: May 2, 2026 · Website:{" "}
        <a href="https://unifiedinboxhub.com/">https://unifiedinboxhub.com/</a>
      </p>

      <p>
        These Terms of Service (“Terms”) govern your access to and use of Unified Inbox Hub’s website and web
        application (collectively, the “Service”) operated at unifiedinboxhub.com. By accessing or using the Service,
        you agree to these Terms. If you are using the Service on behalf of an organization, you represent that you
        have authority to bind that organization, and “you” includes that organization.
      </p>

      <h2>1. The Service</h2>
      <p>
        Unified Inbox Hub provides tools to connect, view, organize, and send email and related communications through
        a unified interface. Features may include multi-account support, synchronization, search, composition,
        notifications, and integrations with third-party providers. We may modify, suspend, or discontinue features as
        we develop the product, provided we give reasonable notice where required by law.
      </p>

      <h2>2. Eligibility and accounts</h2>
      <p>
        You must provide accurate registration information and keep it current. You are responsible for maintaining
        the confidentiality of your credentials and for all activity under your account. Notify us promptly at{" "}
        <a href="mailto:support@unifiedinboxhub.com">support@unifiedinboxhub.com</a> if you suspect unauthorized
        access. We may suspend or terminate accounts that violate these Terms or pose a security risk.
      </p>

      <h2>3. Third-party email and identity providers</h2>
      <p>
        To use certain features, you may connect third-party email accounts or sign in through providers such as
        Google. Your use of those services is subject to their respective terms and privacy policies. You authorize us
        to access and process your data from connected providers only as needed to provide the Service and as permitted
        by you through OAuth scopes or similar permissions. You may disconnect linked accounts at any time where the
        Service allows; disconnecting may limit functionality.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service in violation of law or third-party rights</li>
        <li>Send unsolicited bulk mail, phishing, malware, or deceptive content</li>
        <li>Attempt to gain unauthorized access to the Service, other users’ data, or underlying systems</li>
        <li>Interfere with or disrupt the Service, including by automated means that impose unreasonable load</li>
        <li>Reverse engineer or circumvent security or usage limits, except where such restrictions are prohibited by law</li>
        <li>Use the Service to process highly regulated categories of data without appropriate legal authority and safeguards</li>
      </ul>
      <p>
        We may investigate suspected violations and cooperate with law enforcement or providers when appropriate.
      </p>

      <h2>5. User content</h2>
      <p>
        You retain rights to content you submit through the Service. You grant us a limited license to host, process,
        transmit, and display that content solely to operate and improve the Service for you. You represent that you
        have the rights necessary to grant this license and that your content does not violate applicable law or these
        Terms.
      </p>

      <h2>6. Intellectual property</h2>
      <p>
        The Service, including its software, branding, and documentation, is owned by Unified Inbox Hub and its
        licensors and is protected by intellectual property laws. Except for the limited right to use the Service in
        accordance with these Terms, no rights are granted to you. You may not copy, modify, distribute, or create
        derivative works from our proprietary materials without prior written consent.
      </p>

      <h2>7. Beta and availability</h2>
      <p>
        The Service may be offered with experimental or evolving functionality. We strive for reliability but do not
        guarantee uninterrupted or error-free operation. Scheduled maintenance, provider outages, or security actions
        may affect availability.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED,
        OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
        NON-INFRINGEMENT, TO THE MAXIMUM EXTENT PERMITTED BY LAW. WE DO NOT WARRANT THAT THE SERVICE WILL MEET YOUR
        REQUIREMENTS OR THAT EMAIL DELIVERY, SYNC, OR THIRD-PARTY PROVIDERS WILL ALWAYS FUNCTION WITHOUT INTERRUPTION.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, UNIFIED INBOX HUB AND ITS SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS
        OPPORTUNITIES, ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF
        SUCH DAMAGES. OUR AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE SHALL NOT EXCEED THE GREATER OF
        (A) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B) ONE HUNDRED U.S.
        DOLLARS (US $100), IF YOU HAVE NOT PAID US FEES. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS; IN THOSE
        CASES OUR LIABILITY IS LIMITED TO THE FULLEST EXTENT PERMITTED BY LAW.
      </p>

      <h2>10. Indemnity</h2>
      <p>
        You will defend, indemnify, and hold harmless Unified Inbox Hub and its affiliates, directors, employees, and
        agents from any claims, damages, losses, or expenses (including reasonable attorneys’ fees) arising from your
        use of the Service, your content, your violation of these Terms, or your violation of third-party rights,
        except to the extent caused by our willful misconduct.
      </p>

      <h2>11. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access if you breach these Terms, if
        required by law, or if necessary to protect the Service or other users. Upon termination, your right to use
        the Service ceases; provisions that by their nature should survive (including intellectual property,
        disclaimers, limitation of liability, indemnity, and governing law) will survive.
      </p>

      <h2>12. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the United States and the State of Delaware, without regard to
        conflict-of-law rules, except where mandatory consumer protection laws in your country of residence apply.
        Courts in Delaware shall have exclusive jurisdiction for disputes subject to this section, unless applicable
        law requires otherwise. You and we agree that the United Nations Convention on Contracts for the International
        Sale of Goods does not apply.
      </p>

      <h2>13. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will post the updated Terms on this page and revise the “Last
        updated” date. For material changes, we may provide additional notice. Continued use after the effective date
        constitutes acceptance of the revised Terms, where permitted by law. If you do not agree, you must stop using
        the Service.
      </p>

      <h2>14. Contact</h2>
      <p>
        For questions about these Terms, contact{" "}
        <a href="mailto:legal@unifiedinboxhub.com">legal@unifiedinboxhub.com</a> or visit{" "}
        <a href="https://unifiedinboxhub.com/">https://unifiedinboxhub.com/</a>.
      </p>

      <p className="text-sm text-neutral-600 not-prose border-t border-neutral-200 pt-6 mt-8">
        These Terms are provided for operational clarity. They are not a substitute for legal advice tailored to your
        business or jurisdiction.
      </p>
    </LegalPageLayout>
  );
}
