import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AdminAction = "list" | "create" | "extend" | "revoke";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function computeExpiry(body: {
  access_days?: number;
  access_until?: string;
  extend_days?: number;
  access_minutes?: number;
  access_hours?: number;
  extend_minutes?: number;
  extend_hours?: number;
  current_expires_at?: string | null;
}): string | null {
  if (typeof body.access_until === "string" && body.access_until.trim()) {
    const d = new Date(body.access_until);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  const base = body.current_expires_at ? new Date(body.current_expires_at) : new Date();
  const start = base.getTime() > Date.now() ? base : new Date();
  const result = new Date(start);

  const minutes = typeof body.access_minutes === "number" ? body.access_minutes : body.extend_minutes;
  if (typeof minutes === "number" && minutes > 0) {
    result.setMinutes(result.getMinutes() + minutes);
    return result.toISOString();
  }

  const hours = typeof body.access_hours === "number" ? body.access_hours : body.extend_hours;
  if (typeof hours === "number" && hours > 0) {
    result.setHours(result.getHours() + hours);
    return result.toISOString();
  }

  const days = typeof body.access_days === "number" ? body.access_days : body.extend_days;
  if (typeof days === "number" && days > 0) {
    result.setDate(result.getDate() + days);
    return result.toISOString();
  }

  return null;
}

async function requireAdmin(authHeader: string | null) {
  if (!authHeader) return { error: json({ ok: false, error: "Unauthorized" }, 401) };

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { error: json({ ok: false, error: "Unauthorized" }, 401) };

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return { error: json({ ok: false, error: "Admin only" }, 403) };

  return { user, admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const gate = await requireAdmin(req.headers.get("Authorization"));
    if ("error" in gate && gate.error) return gate.error;
    const { user: adminUser, admin } = gate as { user: { id: string }; admin: ReturnType<typeof createClient> };

    const body = await req.json().catch(() => ({}));
    const action = body.action as AdminAction;

    if (action === "list") {
      const { data: authData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 500 });
      if (listErr) throw listErr;

      const ids = (authData.users ?? []).map((u) => u.id);
      const { data: profiles } = await admin.from("profiles").select("id, display_name, access_expires_at, created_at").in("id", ids);
      const { data: roles } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);

      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
      const rolesByUser = new Map<string, string[]>();
      for (const r of roles ?? []) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push(r.role);
        rolesByUser.set(r.user_id, list);
      }

      const now = Date.now();
      const users = (authData.users ?? []).map((u) => {
        const profile = profileById.get(u.id);
        const userRoles = rolesByUser.get(u.id) ?? [];
        const isAdminRole = userRoles.includes("admin");
        const expiresAt = profile?.access_expires_at ?? null;
        const active = isAdminRole || (expiresAt ? new Date(expiresAt).getTime() > now : false);
        return {
          id: u.id,
          email: u.email ?? "",
          display_name: profile?.display_name ?? u.user_metadata?.display_name ?? null,
          roles: userRoles,
          access_expires_at: expiresAt,
          created_at: profile?.created_at ?? u.created_at,
          status: isAdminRole ? "admin" : active ? "active" : "expired",
        };
      });

      return json({ ok: true, users });
    }

    if (action === "create") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
      const expiresAt = computeExpiry(body);

      if (!email || !password || password.length < 8) {
        return json({ ok: false, error: "Email and password (min 8 characters) required" }, 400);
      }
      if (!expiresAt) {
        return json({ ok: false, error: "Set access duration (time, days, or expiry date)" }, 400);
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName || email.split("@")[0] },
      });
      if (createErr) throw createErr;
      const userId = created.user?.id;
      if (!userId) throw new Error("User creation failed");

      await admin.from("profiles").update({
        access_expires_at: expiresAt,
        created_by_admin_id: adminUser.id,
        display_name: displayName || null,
      }).eq("id", userId);

      return json({ ok: true, user_id: userId, access_expires_at: expiresAt });
    }

    if (action === "extend") {
      const userId = body.user_id as string | undefined;
      if (!userId) return json({ ok: false, error: "user_id required" }, 400);

      const { data: profile } = await admin.from("profiles").select("access_expires_at").eq("id", userId).maybeSingle();
      const expiresAt = computeExpiry({
        access_days: body.access_days,
        access_until: body.access_until,
        access_minutes: body.access_minutes,
        access_hours: body.access_hours,
        extend_days: body.extend_days ?? body.access_days,
        extend_minutes: body.extend_minutes ?? body.access_minutes,
        extend_hours: body.extend_hours ?? body.access_hours,
        current_expires_at: profile?.access_expires_at ?? null,
      });
      if (!expiresAt) return json({ ok: false, error: "Set extension (time, days, or expiry date)" }, 400);

      const { error: extErr } = await admin.from("profiles").update({ access_expires_at: expiresAt }).eq("id", userId);
      if (extErr) throw extErr;

      return json({ ok: true, access_expires_at: expiresAt });
    }

    if (action === "revoke") {
      const userId = body.user_id as string | undefined;
      if (!userId) return json({ ok: false, error: "user_id required" }, 400);

      const nowIso = new Date().toISOString();
      const { error: revErr } = await admin.from("profiles").update({ access_expires_at: nowIso }).eq("id", userId);
      if (revErr) throw revErr;

      return json({ ok: true, access_expires_at: nowIso });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("admin-users error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
