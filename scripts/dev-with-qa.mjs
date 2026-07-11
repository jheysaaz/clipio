import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const cmd = isWindows ? "pnpm.cmd" : "pnpm";

let qaServer = null;
let wxtDev = null;
let shuttingDown = false;

function startQaServer() {
  qaServer = spawn("node", ["scripts/dev-qa-server.mjs"], {
    stdio: "inherit",
    env: process.env,
  });

  qaServer.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[dev-with-qa] QA server exited with code ${code ?? 0}, restarting...`);
    setTimeout(startQaServer, 1000);
  });
}

function startWxtDev() {
  wxtDev = spawn(cmd, ["exec", "wxt"], {
    stdio: "inherit",
    env: process.env,
  });

  wxtDev.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[dev-with-qa] WXT dev exited with code ${code ?? 0}`);
    stopAll(code ?? 0);
  });
}

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (qaServer && !qaServer.killed) qaServer.kill("SIGTERM");
  if (wxtDev && !wxtDev.killed) wxtDev.kill("SIGTERM");
  process.exit(code);
}

startQaServer();
startWxtDev();

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));