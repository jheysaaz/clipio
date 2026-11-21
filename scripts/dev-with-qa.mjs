import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const cmd = isWindows ? "pnpm.cmd" : "pnpm";

const port = process.env.E2E_SERVER_PORT ?? "7777";
const qaUrl = `http://localhost:${port}/manual-qa.html`;
// dev-qa-server.mjs uses this code when the port is taken by something else.
// Unlike a crash, that is not going to fix itself on the next restart.
const PORT_IN_USE_EXIT_CODE = 2;

let qaServer = null;
let wxtDev = null;
let shuttingDown = false;

function startQaServer() {
  if (shuttingDown) return;
  qaServer = spawn("node", ["scripts/dev-qa-server.mjs"], {
    stdio: "inherit",
    env: process.env,
  });

  qaServer.on("exit", (code) => {
    if (shuttingDown) return;
    if (code === PORT_IN_USE_EXIT_CODE) {
      console.error(
        `[dev-with-qa] QA server could not bind ${port}; stopping dev instead of retrying forever.`
      );
      stopAll(code);
      return;
    }
    console.error(
      `[dev-with-qa] QA server exited with code ${code ?? 0}, restarting...`
    );
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
  const children = [qaServer, wxtDev].filter(
    (child) => child && child.exitCode === null && child.signalCode === null
  );
  if (children.length === 0) {
    process.exit(code);
    return;
  }

  // Exiting immediately after `kill()` is how a dev server gets orphaned: the
  // child never sees SIGTERM and keeps holding its port after the parent is
  // gone. Wait for the children, and escalate if one does not go quietly.
  let left = children.length;
  const finished = () => {
    if (--left === 0) process.exit(code);
  };
  const forceKill = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 3000);
  for (const child of children) {
    child.once("exit", finished);
    child.kill("SIGTERM");
  }
  forceKill.unref();
}

/**
 * The E2E webServer and this dev server serve the same directory on the same
 * port. Playwright's `reuseExistingServer` already avoids starting a second
 * copy in that direction; do the same here so leaving `pnpm test:e2e` running
 * cannot break `pnpm dev`.
 */
async function isQaServerRunning() {
  try {
    const response = await fetch(qaUrl, {
      signal: AbortSignal.timeout(1000),
    });
    return (
      response.ok &&
      (await response.text()).includes("Clipio Manual QA Harness")
    );
  } catch {
    return false;
  }
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

if (await isQaServerRunning()) {
  console.log(`[dev-with-qa] Reusing QA server already running at ${qaUrl}`);
} else {
  startQaServer();
}
startWxtDev();
