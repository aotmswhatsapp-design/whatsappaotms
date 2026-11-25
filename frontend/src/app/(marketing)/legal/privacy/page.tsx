import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How AOTMS Global Private Limited collects, uses, stores, processes and protects personal information in the AOTMS WhatsApp automation platform.",
};

const LAST_UPDATED = "November 25, 2026";
const PRIVACY_CONTACT = "ameen@aotms.com";
const POLICY_URL = "https://whatsapp.aotms.com/legal/privacy";

export default function PrivacyPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        Legal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Privacy policy
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted-foreground">
        <PolicySection n={1} title="Introduction">
          <p>
            AOTMS Global Private Limited (“AOTMS”, “we”, “our”, or “us”)
            respects your privacy and is committed to protecting personal
            information processed through our website, software, and WhatsApp
            automation platform.
          </p>
          <p>
            This Privacy Policy explains how we collect, use, store, process,
            and protect personal information when businesses and their
            authorized users use AOTMS.
          </p>
        </PolicySection>

        <PolicySection n={2} title="Company information">
          <p>
            <span className="font-medium text-foreground">Legal entity:</span>{" "}
            AOTMS Global Private Limited
          </p>
          <p>
            <span className="font-medium text-foreground">
              Business address:
            </span>{" "}
            Pothuri Towers, 2nd Floor, MG Road, Near DV Manor, Vijayawada –
            520010, Andhra Pradesh, India.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Privacy contact:
            </span>{" "}
            <a className="underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
              {PRIVACY_CONTACT}
            </a>
          </p>
          <p>
            <span className="font-medium text-foreground">Website:</span>{" "}
            <a
              className="underline underline-offset-4"
              href="https://whatsapp.aotms.com"
            >
              https://whatsapp.aotms.com
            </a>
          </p>
        </PolicySection>

        <PolicySection n={3} title="Information we collect">
          <p>Depending on how you use our services, we may collect:</p>
          <Bullets
            items={[
              "Name, email address, and phone number.",
              "Business name and business account information.",
              "Login credentials and authentication information.",
              "WhatsApp Business Account IDs and phone number IDs.",
              "WhatsApp messages, conversation history, and contact information.",
              "Message delivery, read, and status information.",
              "Message templates and campaign information.",
              "Customer support requests and communications.",
              "Technical information such as IP address, browser information, and usage logs.",
            ]}
          />
        </PolicySection>

        <PolicySection n={4} title="WhatsApp Business Platform integration">
          <p>
            AOTMS integrates with the official Meta WhatsApp Business Platform
            and WhatsApp Cloud API.
          </p>
          <p>
            When a business connects its WhatsApp Business Account, we may
            process:
          </p>
          <Bullets
            items={[
              "Incoming and outgoing WhatsApp messages.",
              "Customer phone numbers and contact details.",
              "Message timestamps and delivery statuses.",
              "WhatsApp Business Account and phone number identifiers.",
              "Message templates and communication events.",
            ]}
          />
          <p>
            Businesses authorize the connection through Meta’s authorization
            and onboarding process.
          </p>
          <p>
            We process this information to provide shared inbox functionality,
            customer support, automated messaging, templates, campaigns, and
            communication analytics.
          </p>
        </PolicySection>

        <PolicySection n={5} title="Artificial intelligence processing">
          <p>
            AOTMS provides AI-powered features that may process customer
            messages and conversation context to generate automated responses
            and assist businesses with customer communication.
          </p>
          <p>
            AI processing may involve authorized AI service providers acting on
            our behalf.
          </p>
          <p>
            We use AI processing to provide requested platform functionality.
            Businesses remain responsible for reviewing automated responses and
            ensuring their use complies with applicable laws and WhatsApp
            policies.
          </p>
          <p>
            We do not intentionally use customer conversations for unrelated
            purposes.
          </p>
        </PolicySection>

        <PolicySection n={6} title="How we use information">
          <p>We use collected information to:</p>
          <Bullets
            items={[
              "Provide and maintain AOTMS services.",
              "Connect and manage WhatsApp Business Accounts.",
              "Send and receive WhatsApp messages.",
              "Operate shared inboxes and team communication tools.",
              "Generate AI-assisted responses.",
              "Manage approved messaging templates and campaigns.",
              "Provide analytics and reporting.",
              "Maintain platform security and prevent misuse.",
              "Troubleshoot technical problems.",
              "Respond to customer support requests.",
              "Meet applicable legal obligations.",
            ]}
          />
        </PolicySection>

        <PolicySection n={7} title="Data sharing and third-party services">
          <p>
            We may share information with authorized service providers when
            necessary to operate AOTMS.
          </p>
          <p>These providers may include:</p>
          <Bullets
            items={[
              "Cloud hosting and infrastructure providers.",
              "Database and storage providers.",
              "AI processing providers.",
              "Security, monitoring, and technical support providers.",
            ]}
          />
          <p>
            Service providers are permitted to process information only as
            necessary to provide their services to AOTMS, subject to applicable
            contractual and legal obligations.
          </p>
          <p>We do not sell personal information to third parties.</p>
        </PolicySection>

        <PolicySection n={8} title="Data security">
          <p>
            We use appropriate technical and organizational safeguards designed
            to protect information against unauthorized access, alteration,
            disclosure, or destruction.
          </p>
          <p>
            These safeguards may include encryption, access controls,
            authentication, and workspace-level data isolation.
          </p>
          <p>
            However, no internet-based service can guarantee absolute security.
          </p>
        </PolicySection>

        <PolicySection n={9} title="Data retention">
          <p>
            We retain personal information for as long as necessary to provide
            our services and meet applicable legal obligations.
          </p>
          <p>
            Following account termination, customer data is retained for up to
            12 months, after which it is deleted or anonymized, unless a longer
            retention period is required or permitted by law.
          </p>
          <p>
            Certain backups and security records may remain temporarily
            according to applicable backup and operational retention procedures.
          </p>
        </PolicySection>

        <PolicySection n={10} title="Data deletion requests">
          <p>
            Customers may request deletion of their personal information by
            contacting:
          </p>
          <p>
            <span className="font-medium text-foreground">Email:</span>{" "}
            <a className="underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
              {PRIVACY_CONTACT}
            </a>
          </p>
          <p>
            Please include sufficient information to identify your account and
            specify the data you want deleted.
          </p>
          <p>
            We will review and process valid requests in accordance with
            applicable legal requirements.
          </p>
          <p>
            Deletion may be subject to legal retention obligations and necessary
            security or backup procedures.
          </p>
        </PolicySection>

        <PolicySection n={11} title="Customer responsibilities and consent">
          <p>
            Businesses using AOTMS are responsible for ensuring that they have
            the necessary legal basis and customer permissions to collect and
            process personal information and communicate through WhatsApp.
          </p>
          <p>
            Businesses must obtain appropriate opt-in consent before sending
            marketing communications.
          </p>
          <p>
            AOTMS expects customers to comply with applicable privacy laws and
            Meta WhatsApp Business policies.
          </p>
        </PolicySection>

        <PolicySection n={12} title="Cookies and website technologies">
          <p>
            Our website may use cookies and similar technologies for
            authentication, session management, security, and service
            functionality.
          </p>
          <p>
            You can manage cookies through your browser settings. Disabling
            certain cookies may affect platform functionality.
          </p>
        </PolicySection>

        <PolicySection n={13} title="Children’s privacy">
          <p>
            AOTMS is a business-focused platform and is not intended for
            children. We do not knowingly collect personal information directly
            from children.
          </p>
        </PolicySection>

        <PolicySection n={14} title="International data processing">
          <p>
            Our infrastructure and service providers may process information in
            locations outside the country where the information was collected.
          </p>
          <p>
            Where applicable, we take steps designed to ensure that such
            processing complies with relevant data protection requirements.
          </p>
        </PolicySection>

        <PolicySection n={15} title="Your privacy rights">
          <p>Subject to applicable law, individuals may have rights to:</p>
          <Bullets
            items={[
              "Request access to their personal information.",
              "Request correction of inaccurate information.",
              "Request deletion of personal information.",
              "Raise concerns about how their information is processed.",
              "Withdraw consent where processing is based on consent.",
            ]}
          />
          <p>
            Requests may be submitted to{" "}
            <a className="underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
              {PRIVACY_CONTACT}
            </a>
            .
          </p>
        </PolicySection>

        <PolicySection n={16} title="Changes to this Privacy Policy">
          <p>
            We may update this Privacy Policy when our services, practices, or
            legal obligations change.
          </p>
          <p>
            Updated versions will be published on our website with a revised
            Last Updated date.
          </p>
        </PolicySection>

        <PolicySection n={17} title="Contact us">
          <p>
            For questions, concerns, or requests relating to this Privacy
            Policy, contact:
          </p>
          <address className="not-italic">
            <span className="font-medium text-foreground">
              AOTMS Global Private Limited
            </span>
            <br />
            Pothuri Towers, 2nd Floor, MG Road, Near DV Manor, Vijayawada –
            520010, Andhra Pradesh, India.
            <br />
            Email:{" "}
            <a className="underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
              {PRIVACY_CONTACT}
            </a>
            <br />
            Privacy Policy URL:{" "}
            <a className="underline underline-offset-4" href={POLICY_URL}>
              {POLICY_URL}
            </a>
          </address>
        </PolicySection>
      </div>
    </section>
  );
}

function PolicySection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      {/* The section id is the anchor a support reply can link to. */}
      <h2
        id={`section-${n}`}
        className="scroll-mt-24 text-base font-semibold text-foreground"
      >
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
