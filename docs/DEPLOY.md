# Deploying the FashionCart MCP server to Vercel

Verified against Vercel's docs on 2026-09-06. Every command below is PowerShell-native; the
upstream docs are bash-only and several of their examples are hard parse errors in PowerShell
(noted where relevant).

---

## Why Vercel and not Cloudflare Workers

The loader reads `data/catalog.json` with `node:fs` at cold start. Workers has no `node:fs`, so
the feed would have to be bundled into the worker or moved to KV/R2 — which breaks the "replace
one JSON file to swap the catalog" property that is a first-class requirement here. Anthropic
also names "Cloudflare Workers without a `/.well-known/*` route" as unable to serve connector
metadata correctly.

## What is already configured

| file | purpose |
|---|---|
| `api/index.ts` | exports the Express app as the function handler (no `listen()`) |
| `src/app.ts` | the app factory, shared by local dev and the serverless handler |
| `vercel.json` | `maxDuration`, `includeFiles`, catch-all rewrite, image cache headers |
| `.vercelignore` | keeps `.env` out of the upload (see the trap below) |
| `package.json` `engines.node` | `24.x` |
| `scripts/copy-data.mjs` | stages the feed into the function root |

### Five config decisions, each with a reason

1. **`api/index.ts` plus a catch-all rewrite, not zero-config Express detection.** Vercel's
   Express preset only detects `app` / `index` / `server` at the project root or under `src/`.
   `api/index.ts` is not in that list, so the app builds as a plain Node function reachable only
   under `/api`. The rewrite `{"source": "/(.*)", "destination": "/api"}` is what makes
   `POST /mcp` reachable. Without it, every MCP request 404s.
2. **No `runtime` key.** `functions.<glob>.runtime` exists only for community runtimes; setting
   it would push us off the auto-detected Node runtime.
3. **No `memory` key.** Memory cannot be set in `vercel.json` when Fluid compute is enabled,
   which is the default. Use the dashboard Functions section if it ever matters.
4. **Node pinned in `package.json`, not `vercel.json`.** There is no `nodeVersion` key in
   `vercel.json` (there is a `bunVersion`, confusingly). `engines.node` overrides the dashboard
   setting. Node 20 is deprecated; 24.x is the documented recommendation and the platform default.
5. **`includeFiles: "data/**"` is a single glob string, not an array.** `node:fs` reads are not
   import-traced, so without it the bundler drops the catalog and the function throws ENOENT on
   cold start.

## Traps that would have cost you a deploy

- **A plain `.env` IS uploaded.** Vercel's default ignore list contains only `.env.local` and
  `.env.*.local`. Deployment source is readable, so a plain `.env` would ship its contents.
  `.vercelignore` now excludes it explicitly. (Our Pexels key lives in the repo root `.env`,
  outside this deploy root, so it was never in scope — but the rule is worth holding anyway.)
- **`express.static()` is ignored on Vercel.** The `/images` Express route in `app.ts` is dead
  in production. Images are served from `public/**` by the CDN, which is also what keeps image
  bytes away from the 4.5 MB function response limit. Local and production paths match, so
  nothing changes for the widget.
- **The FIRST deploy of a new project is a PRODUCTION deploy**, even without `--prod`. There is
  no "throwaway smoke test" first push.
- **`vercel env add` is sensitive-by-default** for production and preview. You cannot read the
  value back afterwards — only overwrite it. Keep your own copy of `CHECKOUT_SECRET`.
- **PowerShell parse errors in the official examples:** `vercel env add X production < file`
  fails (`The '<' operator is reserved for future use`), `printf ... >> .vercelignore` fails
  (no `printf`), and `vercel ... > url.txt` writes a UTF-8 BOM that corrupts the URL when read
  back. All avoided below.

---

## Steps

```powershell
npm install -g vercel@latest
vercel --version

Set-Location ".\packages\mcp-server"   # from the repository root
```

**1. Log in.** Interactive; opens a browser and returns to the terminal. There is no
non-interactive login — a token is the only CI path.

```powershell
vercel login
vercel whoami
```

**2. Link the project.** You have no existing Vercel project, which is the normal case; this
creates one. Name it explicitly: the default is the *directory* name, which would be
`mcp-server`.

```powershell
vercel link --yes --project fashioncart-mcp
```

**3. Set environment variables.** Use the interactive prompt rather than a pipe — piping puts
the secret into PowerShell history.

```powershell
vercel env add CHECKOUT_SECRET production
# paste a long random value when prompted, then keep your own copy

vercel env add MERCHANT_URL production
# paste: https://<your-merchant-project>.vercel.app   (placeholder; the merchant site is not built yet)
```

Generate a secret first if you need one:

```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

You do **not** need to set `PUBLIC_URL`. It self-resolves from Vercel's injected domain, which
avoids a chicken-and-egg problem: `PUBLIC_URL` feeds `_meta.ui.csp.resourceDomains`, and getting
it wrong would CSP-block the widget's images — the exact failure the Phase 2 gate exists to
detect.

**4. Stage the feed and deploy.**

```powershell
npm run predeploy      # copies data/*.json into the function root
vercel deploy --prod
```

`npm run deploy` chains both, which is safer than calling `vercel deploy` directly and
forgetting the staging step.

**5. Verify before touching claude.ai.**

```powershell
$base = "https://<your-mcp-project>.vercel.app"    # use the URL the CLI printed

Invoke-RestMethod "$base/health"
# expect: ok=true, products=60, protocol=2025-11-25, publicUrl=<your deployment>

(Invoke-WebRequest "$base/images/FC-SHT-001/thumb.webp" -UseBasicParsing).StatusCode
# expect: 200, Content-Type image/webp

$body = @{ jsonrpc="2.0"; id=1; method="tools/list"; params=@{} } | ConvertTo-Json
$r = Invoke-WebRequest "$base/mcp" -Method Post -Body $body -ContentType "application/json" `
     -Headers @{ Accept="application/json, text/event-stream" } -UseBasicParsing
$r.Content
# expect: 7 tools
```

Check `publicUrl` in the health output specifically. If it is not your real deployment origin,
the CSP will be wrong and the image probe in the gate will fail for our reason rather than
Claude's.

**6. Add the connector.** Only UI step in the whole project. Either paste the URL under
Customize > Connectors > Add custom connector, or use a prefilled install link:

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=FashionCart&connectorUrl=https%3A%2F%2F<your-mcp-project>.vercel.app%2Fmcp
```

The link only prefills; you still confirm. Note the endpoint is `/mcp`, not the bare origin.

---

## Plan caveat

Vercel's Hobby tier is intended for non-commercial use. If you use a deployment of this
project commercially, check your plan first.

Relevant plan limits: Hobby `maxDuration` max is 300s (both default and ceiling); Pro is 800s.
Our `vercel.json` requests 300, which is within Hobby.
