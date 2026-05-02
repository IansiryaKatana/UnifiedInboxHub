import type { SupabaseClient } from "@supabase/supabase-js";

export type OutboundAttachment = {
  filename: string;
  mime_type: string;
  size: number;
  /** Inline base64 — omitted when using storage_path */
  data_base64?: string;
  /** Private bucket path under email-attachments */
  storage_path?: string;
};

export function sanitizeAttachmentFilename(name: string): string {
  return name.replace(/[^\w.\-()+@\s]/g, "_").slice(0, 180) || "file";
}

/** Upload to Storage (preferred over embedding base64 in requests). */
export async function uploadOutboundAttachment(
  supabase: SupabaseClient,
  userId: string,
  file: File,
): Promise<OutboundAttachment> {
  const safe = sanitizeAttachmentFilename(file.name);
  const path = `${userId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("email-attachments").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return {
    filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
    storage_path: path,
  };
}
