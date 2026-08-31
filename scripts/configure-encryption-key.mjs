import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const local = process.argv.includes("--local");
const secretName = "SESSION_ENCRYPTION_KEY";
const value = crypto.randomBytes(32).toString("base64url");

if (local) {
  const file = path.resolve(".dev.vars");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const settings = {
    [secretName]: value,
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    LINUXDO_AUTHORIZE_URL: "https://connect.linux.do/oauth2/authorize",
    LINUXDO_TOKEN_URL: "https://connect.linux.do/oauth2/token",
    LINUXDO_USER_URL: "https://connect.linux.do/api/user",
    DEV_LOGIN_ENABLED: "true",
    MAX_MONITORS_PER_USER: "3",
  };
  const lines = current.split(/\r?\n/).filter((line) => line.length > 0);
  for (const [name, setting] of Object.entries(settings)) {
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    const entry = `${name}=${JSON.stringify(setting)}`;
    if (index >= 0) lines[index] = entry;
    else lines.push(entry);
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  console.log(`Updated local authentication settings and ${secretName} in .dev.vars (secret value not displayed).`);
} else {
  const wrangler = path.resolve("node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
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
