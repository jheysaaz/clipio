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

// A failed listen emits 'error'. Without a listener Node throws it as an
// unhandled exception, which buried the one useful fact — the port is taken —
// under a stack trace. Report it once and exit with a distinct code so the
// supervisor does not restart us into the same failure forever.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[dev-qa-server] Port ${port} is already in use. Stop the other dev/E2E server ` +
        `(lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill) and try again.`
    );
    process.exitCode = 2;
    return;
  }
  console.error("[dev-qa-server] Failed to start:", error);
  process.exitCode = 1;
});

server.listen(port, () => {
  console.log(
    `Dev QA server listening on http://localhost:${port}/manual-qa.html`
  );
});
