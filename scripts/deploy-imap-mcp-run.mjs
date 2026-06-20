import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = JSON.parse(fs.readFileSync(path.join(root, "deploy-imap-sync-args-only.json"), "utf8"));

const transport = new StreamableHTTPClientTransport(
  new URL("https://mcp.supabase.com/mcp?project_ref=wunaudeomnobojbpoprv"),
);
const client = new Client({ name: "deploy-imap", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "deploy_edge_function",
    arguments: args,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("deploy failed:", e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
