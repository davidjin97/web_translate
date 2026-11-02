import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const port = Number(process.env.LINGO_DEMO_PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path === "/") path = "/extension/demo.html";
    if (!/^\/(extension|scripts)\//.test(path)) throw new Error("Not found");
    const full = resolve(root, `.${path}`);
    if (!full.startsWith(`${root}/extension/`) && !full.startsWith(`${root}/scripts/`)) throw new Error("Not found");
    let data = await readFile(full);
    if (extname(path) === ".html") {
      const injection = path.endsWith("demo.html") ? '<script type="module" src="/scripts/demo-live.js"></script>' : '<script type="module" src="/scripts/demo-bridge.js"></script>';
      const html = data.toString();
      data = Buffer.from(path.endsWith("demo.html") ? html.replace("</body>", `${injection}</body>`) : html.replace("</head>", `${injection}</head>`));
    }
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(data);
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`Lingo development preview: http://localhost:${port}\nSettings: http://localhost:${port}/extension/options.html\nFixture translations only. Install extension/ for live translation.`));
