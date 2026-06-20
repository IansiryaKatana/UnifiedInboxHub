import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sharedFiles = [
  "push-notify.ts",
  "rfc-mail.ts",
  "mail-credentials.ts",
].map((name) => ({
  name: `_shared/${name}`,
  content: fs.readFileSync(path.join(root, `supabase/functions/_shared/${name}`), "utf8"),
}));

const indexTs = fs.readFileSync(path.join(root, "supabase/functions/imap-sync/index.ts"), "utf8");

const payload = {
  name: "imap-sync",
  entrypoint_path: "imap-sync/index.ts",
  verify_jwt: true,
  files: [
    { name: "imap-sync/index.ts", content: indexTs },
    ...sharedFiles,
  ],
};

fs.writeFileSync(path.join(root, "deploy-imap-sync-built.json"), JSON.stringify(payload));
console.log("Wrote deploy-imap-sync-built.json", payload.files.length, "files");
