import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function waitFor(predicate, {
  timeoutMs = 30_000,
  intervalMs = 100,
  description = "condition",
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

export function startNodeService(name, script, { cwd, env }) {
  const logs = [];
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (stream, prefix) => stream.on("data", (chunk) => {
    const line = `${prefix}${chunk}`;
    logs.push(line);
    if (process.env.DEBUG_E2E) process.stderr.write(`[${name}] ${line}`);
  });
  capture(child.stdout, "");
  capture(child.stderr, "ERR: ");
  return { name, child, logs };
}

export async function waitForHealth(baseUrl, service) {
  await waitFor(async () => {
    if (service.child.exitCode !== null) {
      throw new Error(`${service.name} exited (${service.child.exitCode})\n${service.logs.join("")}`);
    }
    const response = await fetch(`${baseUrl}/healthz`);
    return response.ok;
  }, { description: `${service.name} health check` });
}

export async function stopService(service) {
  if (!service || service.child.exitCode !== null) return;
  service.child.kill("SIGTERM");
  const exited = new Promise((resolve) => service.child.once("exit", resolve));
  const timeout = delay(5_000).then(() => "timeout");
  if ((await Promise.race([exited, timeout])) === "timeout") {
    service.child.kill("SIGKILL");
    await exited;
  }
}

export async function jsonRequest(url, { token, method = "GET", body, raw } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}
