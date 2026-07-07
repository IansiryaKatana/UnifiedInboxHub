import { ImapFlow } from "npm:imapflow@1.0.165";

export interface ImapAttempt {
  host: string;
  port: number;
  secure: boolean;
  label: string;
}

export interface ImapConnectResult {
  client: ImapFlow;
  host: string;
  port: number;
  secure: boolean;
}

const IMAP_CONNECT_MS = 12_000;
const IMAP_CONNECT_SLOW_MS = 22_000;
/** Pre-save credential test — fail fast. */
export const IMAP_TEST_CONNECT_BUDGET_MS = 8_000;
export const CONNECT_BUDGET_MS = 10_000;
export const INCREMENTAL_CONNECT_BUDGET_MS = 8_000;

const SSL_ONLY_IMAP_HOSTS = new Set([
  "imap.gmail.com",
  "imap.googlemail.com",
  "imap.hostinger.com",
  "imap.titan.email",
  "imap0101.titan.email",
  "imap.mail.yahoo.com",
  "imap.mail.yahoo.co.uk",
  "outlook.office365.com",
]);

const HOSTINGER_FAMILY_FALLBACKS = [
  { host: "imap.titan.email", port: 993, secure: true, label: "titan-ssl-993" },
  { host: "imap0101.titan.email", port: 993, secure: true, label: "titan-eu-ssl-993" },
  { host: "imap.hostinger.com", port: 993, secure: true, label: "hostinger-ssl-993" },
] as const;

export function normalizedImapHost(host: string): string {
  return host.trim().toLowerCase();
}

export function isHostingerFamilyHost(host: string): boolean {
  const h = normalizedImapHost(host);
  return h.includes("hostinger") || h.includes("titan");
}

function isSslOnlyImapHost(host: string): boolean {
  const h = normalizedImapHost(host);
  if (SSL_ONLY_IMAP_HOSTS.has(h)) return true;
  return h.includes("yahoo") || h.includes("gmail");
}

function imapConnectTimeoutMs(host: string): number {
  const h = normalizedImapHost(host);
  if (h.includes("yahoo") || h.includes("hostinger") || h.includes("titan")) return IMAP_CONNECT_SLOW_MS;
  return IMAP_CONNECT_MS;
}

export function buildImapAttempts(
  host: string,
  configuredPort: number,
  configuredSecure: boolean,
  options?: { incrementalOnly?: boolean },
): ImapAttempt[] {
  const attempts: ImapAttempt[] = [];
  const seen = new Set<string>();
  const add = (h: string, port: number, secure: boolean, label: string) => {
    const key = `${h.toLowerCase()}:${port}:${secure}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ host: h, port, secure, label });
  };

  add(host, configuredPort, configuredSecure, "configured");

  if (options?.incrementalOnly) {
    return attempts;
  }

  const sslOnly = isSslOnlyImapHost(host);
  if (!sslOnly && configuredPort === 993 && configuredSecure) {
    add(host, 143, false, "fallback-starttls-143");
  } else if (!sslOnly && configuredPort === 143 && !configuredSecure) {
    add(host, 993, true, "fallback-ssl-993");
  }

  if (isHostingerFamilyHost(host)) {
    for (const fb of HOSTINGER_FAMILY_FALLBACKS) {
      add(fb.host, fb.port, fb.secure, fb.label);
    }
  }

  return attempts;
}

function createImapClient(
  attempt: ImapAttempt,
  username: string,
  password: string,
  loginMethod?: "LOGIN" | "PLAIN",
): ImapFlow {
  const connectMs = imapConnectTimeoutMs(attempt.host);
  const hostingerFamily = isHostingerFamilyHost(attempt.host);
  const auth: { user: string; pass: string; loginMethod?: "LOGIN" | "PLAIN" } = {
    user: username,
    pass: password,
  };
  if (loginMethod) auth.loginMethod = loginMethod;

  return new ImapFlow({
    host: attempt.host,
    port: attempt.port,
    secure: attempt.secure,
    auth,
    logger: false,
    disableCompression: hostingerFamily,
    connectionTimeout: connectMs,
    greetingTimeout: connectMs,
    socketTimeout: hostingerFamily ? Math.min(connectMs + 8_000, 20_000) : Math.min(connectMs + 12_000, 28_000),
    tls: attempt.secure ? { servername: attempt.host, minVersion: "TLSv1.2" } : undefined,
  });
}

export function isImapAuthOrHostMismatchError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unexpected close") ||
    lower.includes("authentication failed") ||
    lower.includes("invalid credentials") ||
    lower.includes("no permission") ||
    (lower.includes("auth") && !lower.includes("timeout"))
  );
}

async function connectImapAttempt(
  attempt: ImapAttempt,
  username: string,
  password: string,
  deadlineAt?: number,
  options?: { incrementalOnly?: boolean },
): Promise<ImapFlow> {
  const authMethods: Array<"PLAIN" | "LOGIN" | undefined> = options?.incrementalOnly
    ? [undefined]
    : isHostingerFamilyHost(attempt.host)
    ? [undefined, "LOGIN"]
    : [undefined];
  let lastError = "";
  let hostingerRetry = isHostingerFamilyHost(attempt.host);
  for (const loginMethod of authMethods) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      throw new Error(lastError || "IMAP connect timed out (too many server attempts from edge region)");
    }
    let client: ImapFlow | null = null;
    try {
      client = createImapClient(attempt, username, password, loginMethod);
      const remainingMs = deadlineAt !== undefined ? deadlineAt - Date.now() : 15_000;
      if (remainingMs <= 500) {
        throw new Error(lastError || "IMAP connect timed out (too many server attempts from edge region)");
      }
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("IMAP connect timed out")), remainingMs);
        }),
      ]);
      return client;
    } catch (err) {
      try { await client?.close(); } catch {
        try { await client?.logout(); } catch { /* ignore */ }
      }
      lastError = err instanceof Error ? err.message : String(err);
      const lower = lastError.toLowerCase();
      if (hostingerRetry && lower.includes("unexpected close")) {
        hostingerRetry = false;
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      if (isImapAuthOrHostMismatchError(lastError)) break;
    }
  }
  throw new Error(lastError || "Unable to connect");
}

export function smtpHostForImapHost(imapHost: string): string {
  const h = imapHost.trim().toLowerCase();
  if (h.startsWith("imap0101.")) return imapHost.replace(/^imap0101\./i, "smtp0101.");
  return imapHost.replace(/^imap\./i, "smtp.");
}

export function formatImapConnectError(configuredHost: string, configuredPort: number, rawMessage: string): string {
  const cm = rawMessage;
  const lowerCm = cm.toLowerCase();
  const host = configuredHost.toLowerCase();
  let hint = "";
  if (host.includes("gmail") && (lowerCm.includes("auth") || lowerCm.includes("invalid credentials") || lowerCm.includes("authentication failed"))) {
    hint = " Use a 16-character Google App Password (paste with or without spaces). Enable IMAP in Gmail → Settings → Forwarding and POP/IMAP.";
  } else if (host.includes("yahoo")) {
    hint = " Yahoo requires an App Password (Yahoo Account → Security → Generate app password) and IMAP enabled. Use your full @yahoo.com address as username.";
  } else if (host.includes("hostinger") || host.includes("titan")) {
    if (lowerCm.includes("unexpected close")) {
      hint = " The server closed the connection — usually too many IMAP sessions at once. Wait 30 seconds, close other mail apps, then try again.";
    } else if (lowerCm.includes("auth") || lowerCm.includes("invalid credentials")) {
      hint = " Check mailbox password and IMAP host. For Titan: enable “Titan on other apps” in webmail and turn OFF two-factor authentication.";
    } else {
      hint = " For Titan mailboxes: sign in to Titan webmail → Settings → Enable Titan on other apps (required). Turn OFF 2FA — it blocks IMAP. For Hostinger Email use imap.hostinger.com; for Titan use imap.titan.email or imap0101.titan.email (EU).";
    }
  } else if (lowerCm.includes("unexpected close")) {
    hint = " The server closed the connection — usually wrong IMAP host or incorrect password.";
  } else if (lowerCm.includes("establish connection") || lowerCm.includes("upgrade connection")) {
    hint = " The mail server did not respond in time. Confirm IMAP is enabled and host/port match your provider.";
  }
  return `IMAP connect failed (${configuredHost}:${configuredPort}): ${cm}.${hint} Use your full email as username.`;
}

export async function connectImapWithFallbacks(
  host: string,
  configuredPort: number,
  configuredSecure: boolean,
  username: string,
  password: string,
  options?: {
    connectBudgetMs?: number;
    wallDeadlineAt?: number;
    incrementalOnly?: boolean;
  },
): Promise<ImapConnectResult> {
  const connectBudgetMs = options?.connectBudgetMs ?? CONNECT_BUDGET_MS;
  const wallDeadlineAt = options?.wallDeadlineAt ?? Date.now() + connectBudgetMs;
  const attempts = buildImapAttempts(host, configuredPort, configuredSecure, {
    incrementalOnly: options?.incrementalOnly,
  });
  const maxAttempts = options?.incrementalOnly
    ? 1
    : isHostingerFamilyHost(host)
    ? Math.min(2, attempts.length)
    : attempts.length;

  let client: ImapFlow | null = null;
  let lastError = "";
  let tryAlternateHost = !options?.incrementalOnly;
  const connectStartedAt = Date.now();
  const connectDeadlineAt = Math.min(wallDeadlineAt, connectStartedAt + connectBudgetMs);

  for (const attempt of attempts.slice(0, maxAttempts)) {
    if (attempt.label !== "configured" && !tryAlternateHost) continue;
    if (Date.now() >= connectDeadlineAt || Date.now() >= wallDeadlineAt) {
      lastError = lastError || "IMAP connect timed out (too many server attempts from edge region)";
      break;
    }
    try {
      client = await connectImapAttempt(attempt, username, password, connectDeadlineAt, {
        incrementalOnly: options?.incrementalOnly,
      });
      return {
        client,
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
      };
    } catch (err) {
      try { await client?.close(); } catch {
        try { await client?.logout(); } catch { /* ignore */ }
      }
      client = null;
      lastError = err instanceof Error ? err.message : String(err);
      const lowerErr = lastError.toLowerCase();
      tryAlternateHost =
        (isHostingerFamilyHost(host) && isImapAuthOrHostMismatchError(lastError)) ||
        (!isImapAuthOrHostMismatchError(lastError) && (
          lowerErr.includes("establish connection") ||
          lowerErr.includes("upgrade connection") ||
          lowerErr.includes("timed out") ||
          lowerErr.includes("etimedout") ||
          lowerErr.includes("econnrefused")
        ));
    }
  }

  throw new Error(formatImapConnectError(host, configuredPort, lastError || "Unable to connect"));
}

/** Connect-only test used before saving credentials. */
export async function testImapConnection(
  host: string,
  port: number,
  useTls: boolean,
  username: string,
  password: string,
): Promise<{ ok: true; imap_host: string; imap_port: number; imap_use_tls: boolean; smtp_host: string }> {
  const deadline = Date.now() + IMAP_TEST_CONNECT_BUDGET_MS;
  const result = await connectImapWithFallbacks(host, port, useTls, username, password, {
    connectBudgetMs: IMAP_TEST_CONNECT_BUDGET_MS,
    wallDeadlineAt: deadline,
  });
  try {
    await result.client.logout();
  } catch { /* ignore */ }
  return {
    ok: true,
    imap_host: result.host,
    imap_port: result.port,
    imap_use_tls: result.secure,
    smtp_host: smtpHostForImapHost(result.host),
  };
}
