import { supabase } from "@/integrations/supabase/client";

/** Signed URL for private bucket `email-attachments` (download / open in new tab). */
export async function createSignedAttachmentUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("email-attachments")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
