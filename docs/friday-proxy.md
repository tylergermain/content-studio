# Friday Proxy

[Friday Proxy](https://github.com/tylergermain/CLIProxyAPI/tree/friday-proxy) is a fork of CLIProxyAPI that runs on the office's machine and pools several Claude and ChatGPT subscriptions behind one OpenAI- and Anthropic-compatible endpoint. The office can send its workers' inference through it, and shows every account's quota in **☰ → Inference usage**.

## Turning it on

Admins set it up in **⚙️ Settings → Workers → Friday Proxy**:

- **Address**: where the proxy listens, `http://127.0.0.1:8317` by default.
- **API key**: one of the proxy's `access.api-keys`. Workers sign in to the proxy with it.
- **Management key**: the proxy's `management.secret-key`, as it was typed before the proxy hashed it. The office reads each account's quota with it.
- **⚡ Codex workers** and **⚡ Claude workers**: which providers' workers go through the proxy. Both are off until an admin turns them on, and turning one on needs the API key.

Everything is kept in `.agent-office/friday-proxy.json` (mode 0600). The keys never reach a browser; the settings say only whether each one is saved.

A change applies to workers as they start: new hires, restarts and resumed sessions. A worker that's already running keeps the route it started with.

## How workers go through it

- **Codex** workers, and the executive assistant's `codex exec`, get config overrides on their command line:

  ```
  -c model_provider="friday_proxy"
  -c model_providers.friday_proxy.base_url="<address>/v1"
  -c model_providers.friday_proxy.env_key="FRIDAY_PROXY_API_KEY"
  -c model_providers.friday_proxy.wire_api="responses"
  ```

  The key itself is only in the worker's environment (`FRIDAY_PROXY_API_KEY`), never on the command line. Codex still writes its sessions to `~/.codex`, so per-worker token usage reads as before.

- **Claude** workers get `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` as the very last step of their environment. That's after an account's own sign-in is applied, so the sign-in can't undo it.

  Claude Code sends a claude.ai login ahead of any token, so routed Claude workers use a config folder of their own, `.agent-office/friday-proxy/claude`, which has no login in it:
  - Your `~/.claude` skills, agents, commands, plugins, `settings.json` and `CLAUDE.md` are linked in.
  - Its first-run questions are answered already.
  - A folder your own Claude trusts is trusted there too.

  Sessions started before routing was turned on live in the old folder, so resuming one starts fresh.

- Through the proxy, a Claude worker needs no Claude sign-in of its own. So people with accounts can hire Claude workers without signing in to Claude.

Other providers (OpenCode, Pi, Grok…) are untouched. So are the office's own small Claude calls: naming tasks, and the **Claude limits** panel, which keeps showing the office's own Claude plan.

## Inference usage

**☰ → Inference usage** (⚡) lists every account signed in to the proxy, read through its management API every 5 minutes while anyone's in the office. **Refresh** reads them again now. For each account it shows:

- **Claude**: the 5-hour, 7-day and Fable 5 windows; the Fable 5 credit and monthly usage credits, in dollars; and when a limit has been reached, whether usage credits are covering it.
- **Codex**: the 5-hour and weekly (or monthly) windows, rate-limit resets available, and the credit balance. Redeeming a reset is done in the proxy's own console.
- **Other providers**: listed, with a note when the proxy can't read their quota yet.

Each provider's card adds up what's really usable. For example, Fable 5 counts as 0 on an account whose 7-day limit is spent. Emails in account names are partly hidden, since the office is shared.

When a provider workers run through is down to 15% on average, ⚡ comes up on the top bar.

**Open the proxy's console** links to the proxy's own web console. When the proxy listens on loopback and you opened the office by another name (its tailnet name, from a laptop), the link uses that name with the proxy's port.

## Code

- `src/server/friday-proxy/`:
  - `service.ts`: settings and polling.
  - `route.ts`: what the Codex and Claude adapters ask at launch.
  - `quota.ts`: reading quota through the management API.
  - `claude-home.ts`: the routed Claude config folder.
- `src/server/ws/handlers/friday-proxy.ts` and `src/shared/protocol/friday-proxy.ts`: the messages.
- `src/client/features/friday-proxy/`: the panel, the settings row and the ☰ entry.
