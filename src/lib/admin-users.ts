import { supabase } from "@/integrations/supabase/client";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";

export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  roles: string[];
  access_expires_at: string | null;
  created_at: string | null;
  status: "admin" | "active" | "expired";
};

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) throw new Error(parseEdgeFunctionFailure(data, error));
  if (!data?.ok) throw new Error(parseEdgeFunctionFailure(data, error));
  return data as T;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const data = await invokeAdmin<{ users: AdminUserRow[] }>({ action: "list" });
  return data.users ?? [];
}

export async function createAdminUser(payload: {
  email: string;
  password: string;
  display_name?: string;
  access_days?: number;
  access_until?: string;
  access_minutes?: number;
  access_hours?: number;
}) {
  return invokeAdmin<{ user_id: string; access_expires_at: string }>({ action: "create", ...payload });
}

export type AccessDurationMode = "preset" | "add" | "exact";
export type RelativeTimeUnit = "minutes" | "hours" | "days";

export async function extendAdminUserAccess(payload: {
  user_id: string;
  access_days?: number;
  access_until?: string;
  access_minutes?: number;
  access_hours?: number;
}) {
  return invokeAdmin<{ access_expires_at: string }>({ action: "extend", ...payload });
}

export async function revokeAdminUserAccess(userId: string) {
  return invokeAdmin<{ access_expires_at: string }>({ action: "revoke", user_id: userId });
}

export function formatAccessExpiry(iso: string | null): string {
  if (!iso) return "No expiry";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function addDaysFromNow(days: number, fromIso?: string | null): string {
  return addDurationToBase(days, "days", fromIso);
}

export function addDurationToBase(amount: number, unit: RelativeTimeUnit, fromIso?: string | null): string {
  const base = fromIso ? new Date(fromIso) : new Date();
  const start = base.getTime() > Date.now() ? base : new Date();
  const result = new Date(start);
  if (unit === "minutes") result.setMinutes(result.getMinutes() + amount);
  else if (unit === "hours") result.setHours(result.getHours() + amount);
  else result.setDate(result.getDate() + amount);
  return result.toISOString();
}

export function computeAccessUntil(
  mode: AccessDurationMode,
  opts: {
    baseIso?: string | null;
    presetDays?: number;
    addAmount?: number;
    addUnit?: RelativeTimeUnit;
    exactUntil?: string;
  },
): string | null {
  if (mode === "exact" && opts.exactUntil) {
    const d = new Date(opts.exactUntil);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (mode === "add" && opts.addAmount && opts.addAmount > 0 && opts.addUnit) {
    return addDurationToBase(opts.addAmount, opts.addUnit, opts.baseIso);
  }
  if (mode === "preset" && opts.presetDays && opts.presetDays > 0) {
    return addDaysFromNow(opts.presetDays, opts.baseIso);
  }
  return null;
}

export function buildAccessDurationPayload(
  mode: AccessDurationMode,
  opts: {
    presetDays?: number;
    addAmount?: number;
    addUnit?: RelativeTimeUnit;
    exactUntil?: string;
  },
): Record<string, string | number> | null {
  if (mode === "exact" && opts.exactUntil) {
    const d = new Date(opts.exactUntil);
    if (Number.isNaN(d.getTime())) return null;
    return { access_until: d.toISOString() };
  }
  if (mode === "add" && opts.addAmount && opts.addAmount > 0 && opts.addUnit) {
    if (opts.addUnit === "minutes") return { access_minutes: opts.addAmount };
    if (opts.addUnit === "hours") return { access_hours: opts.addAmount };
    return { access_days: opts.addAmount };
  }
  if (mode === "preset" && opts.presetDays && opts.presetDays > 0) {
    return { access_days: opts.presetDays };
  }
  return null;
}

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
