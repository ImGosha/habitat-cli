import { createHabitatApiApp } from "./habitat-api.js";

const defaultHost = "127.0.0.1";
const defaultPort = 8787;

function getServerHost(): string {
  return process.env.HABITAT_API_HOST?.trim() || defaultHost;
}

function getServerPort(): number {
  const rawPort = process.env.HABITAT_API_PORT?.trim();

  if (!rawPort) {
    return defaultPort;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("HABITAT_API_PORT must be a positive whole number.");
  }

  return port;
}

const host = getServerHost();
const port = getServerPort();
const app = createHabitatApiApp();

console.log(`[habitat-api] listening on http://${host}:${port}`);

Bun.serve({
  fetch: app.fetch,
  port,
  hostname: host,
});
