export type AttachmentInput = {
  filename: string;
  mime_type: string;
  size?: number;
  data_base64?: string;
  storage_path?: string;
};

export type ResolvedAttachment = {
  filename: string;
  mime_type: string;
  size: number;
  data_base64: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Resolve attachment payloads for MIME: Storage path (service role) or inline base64 */
export async function resolveAttachmentsForMime(
  supabase: { storage: { from: (name: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }> } } },
  attachments: AttachmentInput[] | undefined,
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = [];
  for (const a of attachments ?? []) {
    if (a.storage_path) {
      const { data, error } = await supabase.storage.from("email-attachments").download(a.storage_path);
      if (error || !data) {
        throw new Error(`Could not load attachment from storage: ${a.filename} (${error?.message ?? "unknown"})`);
      }
      const buf = new Uint8Array(await data.arrayBuffer());
      out.push({
        filename: a.filename,
        mime_type: a.mime_type || "application/octet-stream",
        size: a.size ?? buf.byteLength,
        data_base64: bytesToBase64(buf),
      });
    } else if (a.data_base64) {
      out.push({
        filename: a.filename,
        mime_type: a.mime_type || "application/octet-stream",
        size: a.size ?? Math.ceil(a.data_base64.length * 0.75),
        data_base64: a.data_base64,
      });
    }
  }
  return out;
}
