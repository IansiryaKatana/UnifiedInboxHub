// Google OAuth callback: exchanges code for tokens and creates an email_accounts row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only allow http(s) app URLs for visible fallback links */
function safeReturnHref(returnTo: string): string {
  const u = returnTo && /^https?:\/\//.test(returnTo) ? returnTo : "";
  return u ? escapeHtml(u) : "";
}

/** Inline JSON for <script type="application/json"> — prevents </script> breaking the document. */
function jsonForInlineJsonScript(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function popupResponse(message: string, ok: boolean, returnTo: string, accountId?: string) {
  const payloadObj: Record<string, unknown> = {
    type: "gmail-oauth",
    ok,
    message: message.slice(0, 300),
    account_id: accountId ?? null,
    return_to: returnTo,
  };
  const inlinePayload = jsonForInlineJsonScript(payloadObj);
  const title = ok ? "Gmail connected" : "Could not connect Gmail";
  const lead = ok
    ? "Returning you to the app…"
    : "You can close this window and try again from the app.";

  const returnHref = safeReturnHref(returnTo);

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
      color: #171717;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      text-align: center;
      padding: 2rem 1.5rem;
      max-width: 22rem;
    }
    h1 {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 0.875rem;
      color: #525252;
      margin: 0;
      line-height: 1.5;
    }
    .spinner {
      width: 1.5rem;
      height: 1.5rem;
      margin: 1rem auto 0;
      border: 2px solid #e5e5e5;
      border-top-color: #171717;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fallback-link { margin-top: 1rem; }
    .fallback-link a { color: #171717; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(lead)}</p>
    ${ok ? '<div class="spinner" aria-hidden="true"></div>' : ""}
    ${returnHref ? `<p class="fallback-link"><a href="${returnHref}">Return to the app</a></p>` : ""}
  </div>
  <script type="application/json" id="gmail-oauth-payload">${inlinePayload}</script>
  <script>
    (function () {
      try {
        var raw = document.getElementById("gmail-oauth-payload");
        var payload = JSON.parse(raw ? raw.textContent || "{}" : "{}");
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, "*");
          try { window.opener.focus(); } catch (e) {}
        }
      } catch (e) {}
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, ${ok ? 600 : 900});
    })();
  </script>
</body>
</html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  let returnTo = "/";
  try {
    if (stateRaw) {
      const decoded = JSON.parse(atob(stateRaw)) as { return_to?: string };
      returnTo = typeof decoded.return_to === "string" && decoded.return_to ? decoded.return_to : "/";
    }
  } catch { /* ignore */ }

  // Always return HTML (never HTTP redirect). A 302 navigates whichever tab hit this URL —
  // if that tab was the main app (lost opener / mobile), the SPA reloads and feels like "leaving the app".
  if (errorParam) return popupResponse(`Google returned: ${errorParam}`, false, returnTo);
  if (!code || !stateRaw) return popupResponse("Missing authorization code.", false, returnTo);

  try {
    const state = JSON.parse(atob(stateRaw));
    const userId: string = state.user_id;
    if (!userId) throw new Error("Invalid state");

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Google OAuth not configured");

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData).slice(0, 300)}`);

    const accessToken: string = tokenData.access_token;
    const refreshToken: string | undefined = tokenData.refresh_token;
    const expiresIn: number = tokenData.expires_in ?? 3600;
    const scope: string = tokenData.scope ?? "";

    // Fetch user's email
    const profRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profRes.json();
    if (!profRes.ok) throw new Error(`Profile fetch failed: ${JSON.stringify(profile).slice(0, 300)}`);
    const emailAddress: string = profile.emailAddress;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id, oauth_refresh_token")
      .eq("user_id", userId)
      .eq("email_address", emailAddress)
      .maybeSingle();

    let accountId: string;
    if (existing) {
      await supabase.from("email_accounts").update({
        oauth_access_token: accessToken,
        oauth_refresh_token: refreshToken ?? existing.oauth_refresh_token,
        oauth_token_expires_at: expiresAt,
        oauth_scope: scope,
        provider_type: "gmail",
        sync_status: "idle",
        last_sync_error: null,
      }).eq("id", existing.id);
      accountId = existing.id;
    } else {
      if (!refreshToken) throw new Error("No refresh token returned. Try removing app access at myaccount.google.com/permissions and reconnect.");
      const { data: inserted, error: insertError } = await supabase.from("email_accounts").insert({
        user_id: userId,
        email_address: emailAddress,
        display_name: emailAddress,
        provider_type: "gmail",
        color: "#ea4335",
        sync_status: "idle",
        oauth_access_token: accessToken,
        oauth_refresh_token: refreshToken,
        oauth_token_expires_at: expiresAt,
        oauth_scope: scope,
      }).select("id").single();
      if (insertError || !inserted?.id) throw new Error(insertError?.message ?? "Failed to create Gmail account");
      accountId = inserted.id;
    }

    return popupResponse(`Connected ${emailAddress}. Syncing will begin shortly.`, true, returnTo, accountId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail-oauth-callback error:", msg);
    return popupResponse(msg, false, returnTo);
  }
});
