/**
 * Minimal static file server for E2E test pages.
 * Serves the e2e/helpers/ directory over HTTP on port 7777.
 * Used by Playwright's webServer config so content scripts can inject
 * (Chrome restricts content scripts from file:// URLs).
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.E2E_SERVER_PORT ?? 7777;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const filePath = path.join(__dirname, url.pathname);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`E2E static server listening on http://localhost:${PORT}`);
});
