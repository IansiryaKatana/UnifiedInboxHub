import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const argsPath = path.join(root, "mcp-deploy-args.json");

if (!fs.existsSync(argsPath)) {
  console.error("Missing mcp-deploy-args.json — run: node -e \"...\" first");
  process.exit(1);
}

const args = JSON.parse(fs.readFileSync(argsPath, "utf8"));
console.log(JSON.stringify(args));
