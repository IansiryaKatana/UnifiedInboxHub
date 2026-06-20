import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const argsPath = path.join(root, process.argv[2] ?? "mcp-deploy-args.json");
const args = JSON.parse(fs.readFileSync(argsPath, "utf8"));
process.stdout.write(JSON.stringify(args));
