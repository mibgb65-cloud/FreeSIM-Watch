import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const loginUrl = "https://esim.gg/login?callbackUrl=/new/number/estonia";
const profile = path.resolve(".esimgg-login-profile");

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    if (!path.isAbsolute(candidate)) {
      const result = spawnSync("which", [candidate], { encoding: "utf8" });
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    }
  }
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH and retry.");
}

try {
  const response = await fetch("http://127.0.0.1:9223/json/version");
  if (response.ok) {
    console.log("A browser debugging session is already running on port 9223. Use that window to log in.");
    process.exit(0);
  }
} catch {}

fs.mkdirSync(profile, { recursive: true });
const browser = findBrowser();
const child = spawn(browser, [
  "--remote-debugging-port=9223",
  "--remote-allow-origins=http://127.0.0.1:9223",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  loginUrl,
], { detached: true, stdio: "ignore" });
child.unref();
console.log("Opened a separate esim.gg login browser. Complete login, then generate an import code in the FreeSIM Watch console.");
