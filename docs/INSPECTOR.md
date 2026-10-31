# MCP Inspector - tool-level testing

Verified 2026-09-06 against `@modelcontextprotocol/inspector` **2.5.0** (published 2026-09-02).

Every command published upstream is written in a bash fence. The PowerShell forms below are
translated; where a translation was needed it is called out.

---

## Prerequisites

| | |
|---|---|
| Package | `@modelcontextprotocol/inspector`, one binary `mcp-inspector` |
| Node | **>= 22.19.0** required. This machine runs 24.11.1, so it is satisfied. |
| dist-tags | `latest=2.5.0`, `next=2.0.0-rc.3`, `v1-latest=1.0.2` |

v2 ships three clients behind one binary, selected by a leading mode flag: `--web` (default),
`--cli`, `--tui`. Passing two fails with `Specify at most one of --web, --cli, or --tui.`

## Ports

| port | purpose | env var | notes |
|---|---|---|---|
| 6274 | web UI | `CLIENT_PORT` | **There is no `--port` flag.** A dynamic/0 port is rejected, because the origin allow-list and sandbox CSP derive from it. |
| 6275 | MCP Apps sandbox | `MCP_SANDBOX_PORT` | Fixed by default, not OS-assigned. Must be independently reachable from the browser or the widget will not render. |
| 6276 | CLI/TUI OAuth callback | | `http://127.0.0.1:6276/oauth/callback` |

Binds the IPv4 loopback **address** `127.0.0.1`, deliberately not the name `localhost`. Binding
all interfaces is refused unless `DANGEROUSLY_BIND_ALL_INTERFACES=true`.

## Auth

The web backend mints a random per-launch session token, prints it, and prints a pre-tokenised
URL. **Open the printed URL.** Typing `localhost:6274` by hand will 401 on a fresh session.

Env var is `MCP_INSPECTOR_API_TOKEN` (v1's `MCP_PROXY_AUTH_TOKEN` still works as a deprecated
fallback). It guards every `/api/*` route.

## Transport

Selected by an explicit `--transport <stdio|sse|http>`. `http` is normalised internally to
`streamable-http`. It is **not** a launch-time UI dropdown and not a URL suffix alone.

If `--transport` is omitted, v2 infers it from the URL path suffix only: `/mcp` -> streamable
HTTP, `/sse` -> SSE, anything else is a hard error. Our endpoint is `/mcp`, so inference would
work, but pass the flag explicitly anyway.

Note: the CLI README still carries a v1-era heading "Connect to a remote MCP server (default is
SSE)". That is stale; the code has no SSE default.

## Protocol era - the one that will bite

Inspector models "protocol era" as a per-server setting, orthogonal to transport:

| era | behaviour |
|---|---|
| `legacy` | **the default.** Plain `initialize`, no probing. Negotiates 2025-11-25 as latest. |
| `auto` | probe `server/discover`, fall back |
| `modern` | 2026-07-28 only |

Because it defaults to `legacy`, a 2026-07-28 server is **not** reached by default, and there is
no `--protocol-era` CLI flag to change it.

For FashionCart this is a convenience rather than a problem: we build on the v1 SDK at 2025-11-25,
which is exactly what `legacy` negotiates. No configuration needed.

## MCP Apps support

Supported on both surfaces:

- **web**: a dedicated Apps tab rendering the widget in a sandboxed iframe on port 6275
- **CLI**: `--app-info`, which reads the `ui://` resource a tool declares and reports its CSP

The package itself depends on `@modelcontextprotocol/ext-apps ^1.7.4`, i.e. the MCP Apps SDK.

The sandbox iframe is gated by a `frame-ancestors` CSP tied to the web UI port, which is why
neither port may be reassigned casually.

---

## Commands (PowerShell)

Start the FashionCart dev server on `:3001` first.

**Web UI against our server:**

```powershell
npx @modelcontextprotocol/inspector --server-url http://localhost:3001/mcp --transport http
```

Then open the tokenised URL it prints. Do not type `localhost:6274`.

**CLI, list tools (non-interactive):**

```powershell
npx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method tools/list
```

**CLI, call a tool:**

```powershell
npx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method tools/call --tool-name search-products --tool-arg category=kurtas --format json
```

**CLI, inspect the MCP App a tool declares (its `ui://` resource and CSP):**

```powershell
npx @modelcontextprotocol/inspector --cli --transport http --server-url http://localhost:3001/mcp --method tools/call --tool-name search-products --app-info
```

**Pinned ports and token, scripted launch.** The upstream version of this uses inline
`VAR=value` prefixes, `$(openssl rand -hex 24)` and a trailing `&`, none of which run in
PowerShell. Translated:

```powershell
$env:MCP_INSPECTOR_API_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:HOST = "127.0.0.1"
$env:CLIENT_PORT = "6274"
$env:MCP_SANDBOX_PORT = "6275"
$env:MCP_AUTO_OPEN_ENABLED = "false"
npx @modelcontextprotocol/inspector --web
```

### CLI gotchas

- `--method` is **required** under `--cli`.
- **The target must come first.** The CLI reads the leading run of non-dash tokens as the target,
  so a URL placed after the first flag is silently discarded and the run fails confusingly.
- Exit codes are stable and machine-readable: `1` usage, `2` no-app, `3` auth-required,
  `4` unreachable, `5` tool-error, `6` schema-unportable.

### Stale upstream docs to ignore

- `modelcontextprotocol.io/.../configuration` says `HOST` "defaults to localhost" and
  `MCP_SANDBOX_PORT` is "dynamic by default". Both are stale against the shipped 2.5.0.
- v1 deep links used `transport=streamable-http`; v2 uses `transport=http`.
- v1's Windows-only `npm run dev:windows` script is **gone** in v2. Do not cite it.
