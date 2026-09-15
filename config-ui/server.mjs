import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PROJECT_DIR = process.env.MIGPT_PROJECT_DIR || process.cwd();
const PUBLIC_DIR = path.join(PROJECT_DIR, "config-ui", "public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.MIGPT_CONFIG_PORT || 8765);
const MAX_BODY = 16 * 1024;

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
};

const readText = async (name, fallback = "") => {
  try {
    return await fs.readFile(path.join(PROJECT_DIR, name), "utf8");
  } catch {
    return fallback;
  }
};

const quoted = (text, key) => {
  const match = text.match(new RegExp(`${key}\\s*:\\s*["']([^"']*)["']`));
  return match?.[1] || "";
};

const envValue = (text, key) => {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim() || "";
};

const readConfig = async () => {
  const [envText, migptText, miText] = await Promise.all([
    readText(".env"),
    readText(".migpt.js"),
    readText(".mi.json", "{}"),
  ]);
  let mi = {};
  try {
    mi = JSON.parse(miText);
  } catch {}
  const passToken = mi?.mina?.pass?.passToken || mi?.miiot?.pass?.passToken || "";
  return {
    baseUrl: envValue(envText, "OPENAI_BASE_URL") || "https://yccy.store/v1",
    model: envValue(envText, "OPENAI_MODEL") || "gpt-5.6-luna",
    hasApiKey: Boolean(envValue(envText, "OPENAI_API_KEY")),
    userId: quoted(migptText, "userId"),
    hasPassword: Boolean(quoted(migptText, "password")),
    did: quoted(migptText, "did"),
    hasPassToken: Boolean(passToken),
  };
};

const validate = (input) => {
  const values = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value ?? "").trim()]));
  if (!values.baseUrl || !/^https:\/\//i.test(values.baseUrl)) throw new Error("Base URL 必须以 https:// 开头");
  if (values.baseUrl.length > 500 || values.model.length > 200 || values.apiKey.length > 500) throw new Error("API 配置长度不合法");
  if (values.userId.length > 100 || values.password.length > 300 || values.passToken.length > 1000 || values.did.length > 200) throw new Error("小米配置长度不合法");
  if (!values.userId || !values.did) throw new Error("小米 ID 和音箱名称不能为空");
  return values;
};

const atomicWrite = async (name, content, mode = 0o600) => {
  const target = path.join(PROJECT_DIR, name);
  const temp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, { encoding: "utf8", mode });
  await fs.chmod(temp, mode);
  await fs.rename(temp, target);
};

const saveConfig = async (input) => {
  const values = validate(input);
  const current = await readConfig();
  const existingEnv = await readText(".env");
  const existingApiKey = envValue(existingEnv, "OPENAI_API_KEY");
  const envText = [
    "# 由本地 MiGPT 配置页面生成；此文件不要提交到 GitHub。",
    `OPENAI_BASE_URL=${values.baseUrl}`,
    `OPENAI_MODEL=${values.model}`,
    `OPENAI_API_KEY=${values.apiKey || existingApiKey}`,
    "",
  ].join("\n");
  const oldMigpt = await readText(".migpt.js");
  const oldPassword = quoted(oldMigpt, "password");
  const password = values.password || oldPassword;
  const migptText = `const systemTemplate = \`你是一个友好、简洁的中文语音助手。请直接回答用户问题，不要输出时间、角色名或 Markdown 格式。\`.trim();

export default {
  systemTemplate,
  bot: { name: "小爱助手", profile: "一个友好、可靠、简洁的中文语音助手。" },
  master: { name: "主人", profile: "使用小爱音箱的人。" },
  speaker: {
    userId: ${JSON.stringify(values.userId)},
    password: ${JSON.stringify(password)},
    did: ${JSON.stringify(values.did)},
    callAIKeywords: ["请", "你"],
    streamResponse: false,
    tts: "xiaoai",
    ttsCommand: [5, 1],
    wakeUpCommand: [5, 3],
    onAIAsking: ["让我想想"],
    onAIReplied: [],
    onAIError: ["抱歉，刚才没有处理成功。"],
    debug: false,
    enableTrace: false,
    timeout: 10000,
  },
};
`;
  const oldMiText = await readText(".mi.json", "{}");
  let oldMi = {};
  try { oldMi = JSON.parse(oldMiText); } catch {}
  const token = values.passToken || oldMi?.mina?.pass?.passToken || oldMi?.miiot?.pass?.passToken || "";
  const miText = `${JSON.stringify({
    mina: { pass: { passToken: token } },
    miiot: { pass: { passToken: token } },
  }, null, 2)}\n`;
  await atomicWrite(".env", envText);
  await atomicWrite(".migpt.js", migptText);
  await atomicWrite(".mi.json", miText);
};

const runDocker = () => new Promise((resolve) => {
  const child = spawn("docker", ["compose", "-p", "migpt-local", "up", "-d"], {
    cwd: PROJECT_DIR,
    stdio: "ignore",
  });
  child.on("close", (code) => resolve(code === 0));
  child.on("error", () => resolve(false));
});

const dockerRunning = () => new Promise((resolve) => {
  const child = spawn("docker", ["inspect", "-f", "{{.State.Status}}", "mi-gpt"], { stdio: ["ignore", "pipe", "ignore"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.on("close", (code) => resolve(code === 0 && output.trim() === "running"));
  child.on("error", () => resolve(false));
});

const checkAi = async () => {
  const envText = await readText(".env");
  const baseUrl = envValue(envText, "OPENAI_BASE_URL").replace(/\/$/, "");
  const apiKey = envValue(envText, "OPENAI_API_KEY");
  if (!baseUrl || !apiKey) return { linked: false, message: "请先填写并保存 Base URL 和 API Key" };
  if (!/^https:\/\//i.test(baseUrl)) return { linked: false, message: "Base URL 必须使用 HTTPS" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.ok) return { linked: true, message: "中转站 API 已连接" };
    if (response.status === 401 || response.status === 403) return { linked: false, message: "API Key 无效或没有权限" };
    return { linked: false, message: `API 返回 HTTP ${response.status}，请检查 Base URL` };
  } catch (error) {
    return { linked: false, message: error?.name === "AbortError" ? "连接超时，请检查网络或中转站地址" : "无法连接中转站 API" };
  } finally {
    clearTimeout(timer);
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, await readConfig());
    if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, { running: await dockerRunning() });
    if (req.method === "POST" && url.pathname === "/api/check") return send(res, 200, await checkAi());
    if (req.method === "POST" && (url.pathname === "/api/config" || url.pathname === "/api/start")) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY) return send(res, 413, { error: "请求内容过大" });
      }
      if (url.pathname === "/api/config") {
        await saveConfig(JSON.parse(body));
        return send(res, 200, { ok: true });
      }
      const config = await readConfig();
      if (!config.hasApiKey || (!config.hasPassToken && !config.hasPassword) || !config.userId || !config.did) {
        return send(res, 400, { ok: false, error: "请先完成 API、小米授权和音箱配置" });
      }
      const ok = await runDocker();
      if (ok) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      const stable = ok && await dockerRunning();
      if (!stable) return send(res, 502, { ok: false, error: "MiGPT 未能稳定启动，请检查小米授权或查看本机 Docker 日志" });
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return send(res, 200, await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8"), "text/html; charset=utf-8");
    }
    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : "操作失败" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MiGPT 配置页面：http://${HOST}:${PORT}`);
});
