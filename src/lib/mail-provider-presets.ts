/**
 * Well-known IMAP/SMTP settings for third-party mail hosting (not Gmail — use OAuth in-app).
 * Ports/TLS match each vendor’s typical client configuration and this app’s SMTP layer (465 = implicit TLS).
 */

export type MailProviderPreset = {
  id: string;
  label: string;
  /** Shown under the selector */
  hint?: string;
  imap_host: string;
  imap_port: number;
  imap_use_tls: boolean;
  smtp_host: string;
  smtp_port: number;
 /** Mirrors AddAccountDialog: true = implicit SSL (465), false = STARTTLS-style (587) */
  smtp_use_tls: boolean;
};

/** Sentinel values for the provider Select (not real presets). */
export const MAIL_PRESET_NONE = "none";
export const MAIL_PRESET_CUSTOM = "custom";

export const MAIL_PROVIDER_PRESETS: MailProviderPreset[] = [
  {
    id: "hostinger",
    label: "Hostinger",
    imap_host: "imap.hostinger.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.hostinger.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "titan",
    label: "Titan Mail",
    hint: "Often bundled with Hostinger / business mail",
    imap_host: "imap.titan.email",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.titan.email",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "microsoft365",
    label: "Microsoft 365 / Outlook",
    hint: "Work, school, or @outlook.com / @hotmail.com",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.office365.com",
    smtp_port: 587,
    smtp_use_tls: false,
  },
  {
    id: "rackspace",
    label: "Rackspace Email",
    imap_host: "secure.emailsrvr.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "secure.emailsrvr.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "godaddy",
    label: "GoDaddy",
    imap_host: "imap.secureserver.net",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtpout.secureserver.net",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    imap_host: "imap.zoho.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.zoho.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    imap_host: "imap.mail.yahoo.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.mail.yahoo.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "fastmail",
    label: "Fastmail",
    imap_host: "imap.fastmail.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.fastmail.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "ionos",
    label: "IONOS",
    imap_host: "imap.ionos.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.ionos.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "namecheap",
    label: "Namecheap Private Email",
    imap_host: "mail.privateemail.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "mail.privateemail.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    hint: "Use an app-specific password from Apple ID settings",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_use_tls: false,
  },
  {
    id: "dreamhost",
    label: "DreamHost",
    imap_host: "imap.dreamhost.com",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "smtp.dreamhost.com",
    smtp_port: 465,
    smtp_use_tls: true,
  },
];

export function getMailProviderPreset(id: string): MailProviderPreset | undefined {
  return MAIL_PROVIDER_PRESETS.find((p) => p.id === id);
}

/** If current IMAP+SMTP hosts match a known preset, return its id (else `none`). */
export function matchMailProviderPresetFromHosts(imapHost: string, smtpHost: string): string {
  const ih = imapHost.trim().toLowerCase();
  const sh = smtpHost.trim().toLowerCase();
  if (!ih || !sh) return MAIL_PRESET_NONE;
  const hit = MAIL_PROVIDER_PRESETS.find(
    (p) => p.imap_host.toLowerCase() === ih && p.smtp_host.toLowerCase() === sh,
  );
  return hit?.id ?? MAIL_PRESET_NONE;
}
