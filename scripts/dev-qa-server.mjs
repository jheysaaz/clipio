/**
 * Dev static server for local QA pages.
 * Serves e2e/helpers over HTTP so content scripts can inject normally.
 */

import http from "http";
import fs from "fs";
import path from "path";

const root = path.resolve("e2e/helpers");
const port = process.env.E2E_SERVER_PORT ?? 7777;

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const normalized = path.normalize(url.pathname).replace(/^\/+/, "");
  const candidate = path.resolve(root, normalized);

  if (!candidate.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(candidate, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(candidate);
    res.writeHead(200, { "Content-Type": mime[ext] ?? "text/plain" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(
    `Dev QA server listening on http://localhost:${port}/manual-qa.html`
  );
});
