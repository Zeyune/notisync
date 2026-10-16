import { build } from "../app/node_modules/esbuild/lib/main.js";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(new URL("../.verification/", import.meta.url), { recursive: true });
for (const entry of ["index", "fcm"]) {
  await build({ entryPoints: [fileURLToPath(new URL(`../relay/src/${entry}.ts`, import.meta.url))],
    outfile: fileURLToPath(new URL(`../.verification/${entry}.mjs`, import.meta.url)),
    bundle: true, format: "esm", platform: "neutral", logLevel: "warning" });
}
const result = spawnSync(process.execPath, ["--test", "relay/relay.test.mjs"], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
