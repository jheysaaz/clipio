import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const cmd = isWindows ? "pnpm.cmd" : "pnpm";

const qaServer = spawn("node", ["scripts/dev-qa-server.mjs"], {
  stdio: "inherit",
  env: process.env,
});

const wxtDev = spawn(cmd, ["exec", "wxt"], {
  stdio: "inherit",
  env: process.env,
});

let shuttingDown = false;

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!qaServer.killed) qaServer.kill("SIGTERM");
  if (!wxtDev.killed) wxtDev.kill("SIGTERM");
  process.exit(code);
}

qaServer.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`[dev-with-qa] QA server exited with code ${code ?? 0}`);
    stopAll(code ?? 1);
  }
});

wxtDev.on("exit", (code) => {
  stopAll(code ?? 0);
});

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
