---
name: xiaoai-chatgpt
description: Configure and run MiGPT to connect a Xiaomi XiaoAI speaker to an OpenAI-compatible model API, including the local beginner-friendly configuration page. Use when setting up, repairing, verifying, or migrating this XiaoAI integration.
metadata:
  short-description: 小爱同学接入 ChatGPT
---

# 小爱同学接入 ChatGPT

Use the local configuration page for first-time setup:

```text
打开 MiGPT 配置.command
```

The page binds only to `127.0.0.1:8765`. It writes the local runtime files in the project directory:

- `.env`: OpenAI-compatible `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY`.
- `.migpt.js`: Xiaomi account, speaker name, trigger behavior, and speech settings.
- `.mi.json`: Xiaomi `passToken` authorization for both `mina` and `miiot`.

After the first save, use the prominent “启动AI版小爱同学” button to start Docker without re-entering values. Use “检查 AI 是否已连接” to test the configured provider's `/models` endpoint without generating a chat response.

## Operating rules

- Keep `.env`, `.migpt.js`, `.mi.json`, and any browser-exported cookie out of Git. They are ignored by `.gitignore` and must never be committed.
- The page masks existing API keys, passwords, and `passToken`; an empty secret field means “keep the current local value.”
- Prefer `passToken` authorization obtained locally from the signed-in Xiaomi account when verification links fail or return `securityStatus=16`. Never print or transmit the token.
- Use an OpenAI-compatible Base URL and model ID. Validate the endpoint with a harmless API request before blaming Xiaomi authentication.
- After saving, start with `docker compose -p migpt-local up -d` and verify the container is running. Do not enable verbose MiGPT tracing in normal operation because it can print credentials.
- For end-to-end verification, speak a trigger phrase such as “小爱同学，请介绍一下你自己” and confirm the model provider usage record changes.

## Local files

- Configuration server: `config-ui/server.mjs`
- Configuration page: `config-ui/public/index.html`
- Desktop launcher: `打开 MiGPT 配置.command`
- Runtime launcher: `启动 MiGPT.command`

When changing the configuration UI, keep it local-only, avoid returning secret values from API responses, validate all input server-side, and update files atomically.
