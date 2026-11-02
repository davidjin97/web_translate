import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const root = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest must use V3.");
for (const path of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) {
  if (!existsSync(new URL(path, root))) throw new Error(`Missing extension asset: ${path}`);
}
let checked = 0;
function walk(directory) {
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, file.name);
    if (file.isDirectory()) walk(path);
    else if (file.name.endsWith(".js")) { execFileSync(process.execPath, ["--check", path]); checked++; }
    else if (file.name.endsWith(".html")) {
      const html = readFileSync(path, "utf8");
      if (/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html) || /\bon\w+\s*=/i.test(html)) throw new Error(`Inline JavaScript violates CSP: ${path}`);
      if (/<script[^>]+src=["']https?:/i.test(html)) throw new Error(`Remote code is not allowed: ${path}`);
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        if (/^(#|https?:)/.test(match[1])) continue;
        if (!existsSync(join(directory, match[1]))) throw new Error(`Missing UI asset: ${match[1]}`);
      }
    }
  }
}
walk(root.pathname);
console.log(`Manifest V3, assets, CSP and ${checked} JavaScript files verified.`);
