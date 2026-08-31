import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
const debugBase = process.env.CAPTURE_DEBUG_URL || "http://127.0.0.1:9223";
const secretName = "ESIMGG_SESSION_TOKEN";

function argumentValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function getSessionCookie() {
  const targets = await (await fetch(`${debugBase}/json/list`)).json();
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error(`No Chrome debugging tab found at ${debugBase}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      const message = JSON.parse(raw);
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
  });
  socket.close();

  const cookie = result.cookies.find((item) => item.name === "__Secure-nekopass.session_token" && item.domain.endsWith(".esim.gg"));
  if (!cookie?.value || cookie.value.length < 20) throw new Error("No active esim.gg session token found. Log in first, then retry.");
  return cookie;
}

async function writeCloudflareSecret(value) {
  const wrangler = path.resolve("node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  if (!fs.existsSync(wrangler)) throw new Error("Wrangler is not installed. Run npm install first.");
  const child = spawn(wrangler, ["secret", "put", secretName], {
    cwd: process.cwd(),
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  child.stdin.end(`${value}\n`);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`Wrangler exited with code ${code}`);
  console.log(`Uploaded ${secretName} to Cloudflare (value not displayed).`);
}

async function uploadUserSession(value, expiresAt) {
  const server = argumentValue("--server");
  const code = argumentValue("--code");
  if (!server || !code) throw new Error("Multi-user import requires both --server and --code.");
  const target = new URL("/api/esimgg/session/import", server);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("--server must use http or https.");
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, token: value, expiresAt }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Import server returned HTTP ${response.status}`);
  console.log(`Uploaded the encrypted esim.gg session for the LinuxDo user at ${target.origin} (value not displayed).`);
}

const cookie = await getSessionCookie();
const expiresAt = Number(cookie.expires) > 0 ? new Date(cookie.expires * 1000).toISOString() : null;
console.log(`Found ${cookie.name}; expires ${expiresAt || "with the browser session"}.`);
if (args.has("--check")) process.exit(0);
if (argumentValue("--server") || argumentValue("--code")) await uploadUserSession(cookie.value, expiresAt);
else if (args.has("--legacy-secret")) await writeCloudflareSecret(cookie.value);
else throw new Error("Generate a one-time import command in the web console, then run this command with --server and --code.");
