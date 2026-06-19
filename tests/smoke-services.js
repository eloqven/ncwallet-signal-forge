const http = require("http");
const { spawn } = require("child_process");

const ROOT = process.cwd();
const HOST = "127.0.0.1";

const services = [
  {
    name: "main dashboard",
    command: ["node", ["server.js"]],
    env: { NCWALLET_APP_HOST: HOST, NCWALLET_APP_PORT: "45173" },
    url: "http://127.0.0.1:45173/health",
  },
  {
    name: "gatherer sidecar",
    command: ["node", ["gatherer-sidecar/server.js"]],
    env: {
      GATHERER_SIDECAR_HOST: HOST,
      GATHERER_SIDECAR_PORT: "45290",
      GATHERER_MAIN_APP_BASE: "http://127.0.0.1:45173",
    },
    url: "http://127.0.0.1:45290/health",
  },
  {
    name: "todo runner sidecar",
    command: ["node", ["todo-runner-sidecar/server.js"]],
    env: {
      TODO_RUNNER_HOST: HOST,
      TODO_RUNNER_PORT: "45295",
      TODO_RUNNER_MAIN_APP_BASE: "http://127.0.0.1:45173",
      TODO_RUNNER_GATHERER_BASE: "http://127.0.0.1:45290",
    },
    url: "http://127.0.0.1:45295/health",
  },
  {
    name: "ML sidecar",
    command: ["node", ["ml-sidecar/server.js"]],
    env: { ML_SIDECAR_HOST: HOST, ML_SIDECAR_PORT: "45280" },
    url: "http://127.0.0.1:45280/health",
  },
  {
    name: "Corridor Forge",
    command: ["node", ["apps/corridor-forge/server.js"]],
    env: { SIGNAL_LAB_HOST: HOST, SIGNAL_LAB_PORT: "45186" },
    url: "http://127.0.0.1:45186/health",
  },
];

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body });
          return;
        }
        reject(new Error(`${url} returned HTTP ${res.statusCode}: ${body.slice(0, 160)}`));
      });
    });
    req.setTimeout(1000, () => req.destroy(new Error(`Timeout requesting ${url}`)));
    req.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 8000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      return await request(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function withService(service) {
  const [cmd, args] = service.command;
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code) => {
    if (code && code !== 0) stderr += `\nProcess exited with code ${code}`;
  });

  try {
    await waitFor(service.url);
    console.log(`ok - ${service.name}`);
  } catch (error) {
    throw new Error(`${service.name} smoke check failed: ${error.message}\n${stderr}`.trim());
  } finally {
    child.kill();
  }
}

(async () => {
  for (const service of services) {
    await withService(service);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
