# FashionCart - troubleshooting

For the case where the widget is a blank box and nothing anywhere has raised an error.

This is a **path**, not a checklist. Work down it. Each step tells you what a good answer looks
like and what each bad answer rules out. Stop at the first step that fails: everything below it
is downstream and will fail for the same reason.

Provenance convention follows the rest of this project. **VERIFIED** means it was observed
directly, with the date. **FROM SOURCE** means it was read out of shipped code in
`node_modules`. **INFERRED** means reasoning, not observation. Nothing in this file is a
failure mode we have not actually hit or measured.

Host behaviour described here was observed on claude.ai web (2026-09-07). Payload numbers come
from the measurement scripts in `scripts/`.

---

## Contents

- [0. Read the box first](#0-read-the-box-first)
- [1. The 60-second sweep](#1-the-60-second-sweep)
- [2. Are you even testing the code you think you are](#2-are-you-even-testing-the-code-you-think-you-are)
- [3. Is the connector reachable at all](#3-is-the-connector-reachable-at-all)
- [4. Does tools/list work, and are the tools linked to a widget](#4-does-toolslist-work-and-are-the-tools-linked-to-a-widget)
- [5. Does the tool return structuredContent, and does it fit](#5-does-the-tool-return-structuredcontent-and-does-it-fit)
- [6. Does resources/read return the real widget](#6-does-resourcesread-return-the-real-widget)
- [7. Does the widget mount](#7-does-the-widget-mount)
- [8. Does the widget connect to the host](#8-does-the-widget-connect-to-the-host)
- [9. Do the images load](#9-do-the-images-load)
- [10. Does the cart survive, and does checkout hand off](#10-does-the-cart-survive-and-does-checkout-hand-off)
- [Vercel build and deploy failures, by exact error string](#vercel-build-and-deploy-failures-by-exact-error-string)
- [Windows and PowerShell traps](#windows-and-powershell-traps)
- [Things that look broken and are not](#things-that-look-broken-and-are-not)
- [What this document has not checked](#what-this-document-has-not-checked)

---

## 0. Read the box first

The widget is deliberately chatty about its own state. Before running a single command, look at
what the box actually says. It tells you which step below to jump to and skips the rest.

| What you see | Where you are | Go to |
|---|---|---|
| Nothing at all. No box, no border, no text. The tool answered in the transcript but there is no card. | The host never rendered a view. Either the tool is not linked to the `ui://` resource, or the host did not read the resource. | [4](#4-does-toolslist-work-and-are-the-tools-linked-to-a-widget), then [6](#6-does-resourcesread-return-the-real-widget) |
| A box containing `Loading FashionCart...` and nothing else, forever. | The HTML mounted and ran. `app.connect()` has not resolved, or it resolved but no `ontoolresult` ever fired. | [8](#8-does-the-widget-connect-to-the-host) |
| `Could not connect to the host: <message>` | The bundle ran and `bridge.start()` rejected. The message is the real error. | [8](#8-does-the-widget-connect-to-the-host) |
| `tool result arrived with no structuredContent` | Connected fine. The host delivered a tool result with no `structuredContent` on it. | [5](#5-does-the-tool-return-structuredcontent-and-does-it-fit) |
| `Nothing to show for this result.` | Connected, result arrived, but `structuredContent.kind` was not one the router knows. | [5](#5-does-the-tool-return-structuredcontent-and-does-it-fit) |
| `FashionCart widget not built.` | The server could not read `mcp-app.html` and served `PLACEHOLDER_HTML` from `src/mcp-server.ts`. The pipeline is fine; the bundle is missing. | [2](#2-are-you-even-testing-the-code-you-think-you-are) |
| Product cards render, but every image is a grey placeholder. | Both image rungs failed and the terminal SVG fallback fired. | [9](#9-do-the-images-load) |

Those strings were current on 2026-09-07 and the widget source is under active edit, so confirm
them rather than trusting this table:

```powershell
Set-Location ".\packages\widget"
Select-String -Path src\*.ts -Pattern 'Loading FashionCart|Could not connect|no structuredContent|Nothing to show'
```

The placeholder string lives on the server side:

```powershell
Select-String -Path ".\packages\mcp-server\src\mcp-server.ts" -Pattern 'widget not built'
```

**Empty box with no text at all is the hardest case**, and it is the one this document is
written for. It means the bundle never executed. Skip to step 6: read the resource off the wire
and look at what you actually got.

---

## 1. The 60-second sweep

Paste this whole block into PowerShell. It walks steps 3 to 6 and step 9 in one pass and prints
five lines. It touches nothing, costs nothing, and needs no API key.

```powershell
$FC = "https://<your-mcp-project>.vercel.app"     # or "http://localhost:3001" for the dev server

function Invoke-Mcp {
    param([Parameter(Mandatory)][string] $Json, [string] $Base = $FC)
    $r = Invoke-WebRequest "$Base/mcp" -Method Post -Body $Json -ContentType "application/json" `
         -Headers @{ Accept = "application/json, text/event-stream" } -UseBasicParsing
    ($r.Content -split "`n" | Where-Object { $_ -like "data: *" }) -replace '^data: ', '' | ConvertFrom-Json
}

# 3. reachable, and pointing at itself
$h = Invoke-RestMethod "$FC/health"
"health      : ok=$($h.ok) products=$($h.products) publicUrl=$($h.publicUrl)"

# 4. tools listed, and linked to the ui:// resource
$t = (Invoke-Mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}').result.tools
$linked = @($t | Where-Object { $_._meta.ui.resourceUri }).Count
"tools       : $($t.Count) listed, $linked carry _meta.ui.resourceUri"

# 5. a tool returns structuredContent
$sc = (Invoke-Mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run-diagnostics","arguments":{}}}').result.structuredContent
"tool result : kind=$($sc.kind) probeImage=$($sc.probeImageUrl)"

# 6. the resource is the real widget, with CSP attached
$c = (Invoke-Mcp '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"ui://fashioncart/storefront.html"}}').result.contents[0]
"widget      : mime=$($c.mimeType) chars=$($c.text.Length) resourceDomains=$($c._meta.ui.csp.resourceDomains -join ',')"

# 9. the image the widget will actually try to load
"image       : HTTP $((Invoke-WebRequest $sc.probeImageUrl -UseBasicParsing).StatusCode)  $($sc.probeImageUrl)"
```

Good output, as measured against the local dev server on 2026-09-07:

```
health      : ok=True products=60 publicUrl=http://localhost:3099
tools       : 8 listed, 8 carry _meta.ui.resourceUri
tool result : kind=diagnostics probeImage=http://localhost:3099/images/FC-SHT-001/thumb.webp
widget      : mime=text/html;profile=mcp-app chars=441000 resourceDomains=http://localhost:3099
image       : HTTP 200  http://localhost:3099/images/FC-SHT-001/thumb.webp
```

Any line that is missing, empty, zero, or points at the wrong origin names the step to read.
If every line is good and the widget is still blank, the fault is inside the host and steps 7
to 9 are where it lives.

**The `Invoke-Mcp` helper is not optional ceremony.** The transport answers
`Content-Type: text/event-stream` by default, so the body is SSE frames
(`event: message` then `data: {...}`), not JSON. `Invoke-RestMethod` on `/mcp` will not give
you a parsed object. FROM SOURCE: `enableJsonResponse` defaults to `false` in
`@modelcontextprotocol/sdk` and `src/http-app.ts` does not set it.

---

## 2. Are you even testing the code you think you are

Do this before anything else if the symptom does not match the code you are looking at. Both
traps below produce a confident, wrong PASS.

### 2a. A stale node process is still holding the port

Killing a background task can leave the node child alive and still bound to the port. You then
run your test against yesterday's code and it passes.

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -Unique OwningProcess |
  ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess
    "pid={0}  name={1}  started={2}" -f $p.Id, $p.ProcessName, $p.StartTime
  }
```

VERIFIED 2026-09-07: this returns the owning pid and its `StartTime`. **Compare `StartTime`
against when you last edited a source file.** If the process is older than your edit, you are
testing old code. Kill it and restart:

```powershell
(Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess |
  Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
Start-Sleep -Milliseconds 800
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
  "STILL LISTENING - something else owns 3001"
} else { "port 3001 free" }
```

Same check applies to 8080 and 8081 (the vendored harness) and 6274 and 6275 (Inspector).

### 2b. The staged widget copy is older than the built one

There are three copies of the widget bundle and only one of them ships:

| path | what it is |
|---|---|
| `packages/widget/dist/mcp-app.html` | what `npm run build` in `packages/widget` produces |
| `packages/mcp-server/data/widget/mcp-app.html` | the staged copy, written by `npm run predeploy` |
| whatever Vercel has | whatever was staged at deploy time |

`src/config.ts` `resolveWidgetDir()` prefers the staged copy **only when `process.env.VERCEL`
is set**. That is deliberate, so local edits are not masked. The consequence is that locally you
see the fresh build and the deploy ships the stale staged copy, and the two disagree with no
error anywhere.

```powershell
Set-Location "<path to your clone>"
Get-ChildItem packages\widget\dist\mcp-app.html, packages\mcp-server\data\widget\mcp-app.html |
  Select-Object FullName, Length, LastWriteTime
```

VERIFIED 2026-09-07: these were genuinely out of step on this machine, `dist` at 452,606 bytes
written at 02:38 against a staged copy of 441,000 bytes written at 01:49. Fix by rebuilding then
re-staging, in that order:

```powershell
npm run build:widget
npm --prefix packages\mcp-server run predeploy
```

`npm run deploy` from the repo root chains both. Calling `vercel deploy` directly does not.

---

## 3. Is the connector reachable at all

```powershell
Invoke-RestMethod "https://<your-mcp-project>.vercel.app/health"
```

Good answer, VERIFIED 2026-09-07 against the local server, same shape in production:

```
ok         : True
products   : 60
feedVersion: 1.0
publicUrl  : https://<your-mcp-project>.vercel.app
merchantUrl: https://<your-merchant-project>.vercel.app
protocol   : 2025-11-25
uiProtocol : 2026-01-26
```

What each bad answer means:

- **Connection refused or DNS failure.** The deployment is gone or the URL is wrong. Nothing
  below matters.
- **`products : 0`.** The catalog did not load. On Vercel this is almost always the
  `includeFiles` trap, see [ENOENT on catalog.json](#enoent-on-catalogjson).
- **`publicUrl` is not the origin you just called.** This is the single most load-bearing
  config value in the project and the highest-yield thing on this page. `publicUrl` feeds
  `cspFor()` in `src/config.ts`, which feeds `_meta.ui.csp.resourceDomains`, which is what
  allows the widget to load images at all. If it is wrong, images are CSP-blocked and the
  failure looks like Claude's fault rather than yours. Resolution order in
  `resolvePublicUrl()`: `PUBLIC_URL`, then `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`,
  then `http://localhost:<port>`. If a stale `PUBLIC_URL` is set in the Vercel project it wins
  over everything, which is the usual cause.
- **`protocol` is not `2025-11-25`.** Someone moved the server onto the v2 package line. That
  is mutually exclusive with `@modelcontextprotocol/ext-apps`, which peer-depends on the v1 SDK
  (see the ext-apps package's peer dependencies). MCP Apps will be gone entirely.

### Transport and URL shape

Streamable HTTP only. claude.ai infers the transport from the URL, so:

- the connector URL must be `https://<your-mcp-project>.vercel.app/mcp`, **with the `/mcp` suffix**.
  The bare origin is not the endpoint and will not connect.
- a URL ending `/sse` selects **legacy SSE** instead. We do not serve it. Never add that suffix.
- there is no stdio path in production. `src/main.ts --stdio` exists for local Inspector work
  only.

A browser GET to `/mcp` returns **HTTP 406** with
`{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept text/event-stream"},"id":null}`.
VERIFIED 2026-09-07. **That is correct behaviour, not a fault.** Pasting the endpoint into a
browser is not a health check; `/health` is.

A POST without the right `Accept` header returns HTTP 406 with
`Not Acceptable: Client must accept both application/json and text/event-stream`. VERIFIED
2026-09-07. This is why every command in this file sends
`Accept: application/json, text/event-stream`.

---

## 4. Does tools/list work, and are the tools linked to a widget

```powershell
$t = (Invoke-Mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}').result.tools
$t | ForEach-Object { "{0,-22} {1}" -f $_.name, $_._meta.ui.resourceUri }
```

Good answer, VERIFIED 2026-09-07, eight tools each carrying the same resource URI:

```
search-products        ui://fashioncart/storefront.html
get-product-details    ui://fashioncart/storefront.html
add-to-cart            ui://fashioncart/storefront.html
set-quantity           ui://fashioncart/storefront.html
remove-from-cart       ui://fashioncart/storefront.html
get-cart               ui://fashioncart/storefront.html
checkout               ui://fashioncart/storefront.html
run-diagnostics        ui://fashioncart/storefront.html
```

Inspect one in full:

```powershell
($t | Where-Object name -eq 'search-products')._meta | ConvertTo-Json -Depth 5
```

Good answer, VERIFIED 2026-09-07. Note that **both** key forms are present:

```json
{
  "ui": { "resourceUri": "ui://fashioncart/storefront.html", "visibility": ["model", "app"] },
  "ui/resourceUri": "ui://fashioncart/storefront.html"
}
```

FROM SOURCE (`ext-apps` 1.7.5, `dist/src/server/index.js`): `registerAppTool` mirrors
`_meta.ui.resourceUri` into the deprecated flat key `ui/resourceUri` and vice versa. You write
one, the wire carries both. Seeing only one of them means something is bypassing
`registerAppTool` and calling `server.registerTool` directly.

What each bad answer means:

- **`tools/list` itself fails with a 500.** Registration threw. The most likely cause, VERIFIED
  by direct test on 2026-09-07: a tool registered through `registerAppTool` with **no `_meta`
  key at all** throws `TypeError: Cannot read properties of undefined (reading 'ui')`. Because
  `src/http-app.ts` builds a fresh `McpServer` per request, that throw takes down every single
  `/mcp` call, not just the widget. Check the Vercel function logs for the TypeError.
- **The tool is listed but `_meta.ui.resourceUri` is empty.** VERIFIED 2026-09-07: a tool
  registered with `_meta: {}` registers cleanly, answers normally, and produces **no widget**.
  This is failure mode number one for "the tool works but nothing renders". The fix is one line
  in the relevant `src/tools/*.ts` file: `_meta: { ui: { resourceUri, visibility: ["model", "app"] } }`.
  Blast radius if you change the URI itself: `UI_RESOURCE_URI` is exported once from
  `src/mcp-server.ts` and passed into all four `register*Tools` functions, so all eight tools
  move together. Change it in one place, never per tool.
- **Fewer tools than you expect.** A `registerAppTool` call threw earlier in the sequence, or a
  `register*Tools` call was dropped from `createServer`.
- **Many more tools than eight.** Keep the count small. Early research notes
  record a report of roughly 35k unrequested tokens appended to search results at 33 or more
  tools carrying ui-family `_meta`. Eight is fine. `run-diagnostics` is scaffolding and is meant
  to be deleted once the gate work is done.

### Capability negotiation

The UI extension is declared by the **client**, inside `initialize`, at
`params.capabilities.extensions["io.modelcontextprotocol/ui"]`, value
`{ "mimeTypes": ["text/html;profile=mcp-app"] }`.

Send one by hand:

```powershell
$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"probe","version":"0"},"capabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}}}'
(Invoke-Mcp $init).result | ConvertTo-Json -Depth 5
```

Good answer, VERIFIED 2026-09-07:

```
protocolVersion : 2025-11-25
serverInfo      : fashioncart 0.1.0
capabilities    : {"resources":{"listChanged":true},"tools":{"listChanged":true}}
```

The server does **not** echo the UI extension back. That is expected: `extensions` is a
client-side declaration, and the core spec has no mechanism to negotiate an extension version
(per the MCP core specification). Do not read its absence as a fault.

The server-side check is `getUiCapability(clientCapabilities)`, exported from
`@modelcontextprotocol/ext-apps/server`. FROM SOURCE, the whole implementation is
`clientCapabilities?.extensions?.["io.modelcontextprotocol/ui"]`, returning `undefined` when
the client did not declare it.

**Important, and easy to waste an hour on: FashionCart does not call it.** A grep across
`packages/**/src` finds exactly one hit, a comment on line 15 of `src/config.ts`. Every tool
carries `_meta.ui` unconditionally and nothing degrades on the server side. So there is no
capability gate to inspect here, and adding a probe means writing one. There is also a
structural reason it would buy little: the transport is stateless
(`sessionIdGenerator: undefined`) and `createServer` runs per request, so the server retains no
memory of any `initialize` it answered. A capability check is only meaningful within the
`initialize` request itself.

Verify the grep yourself before assuming otherwise:

```powershell
Set-Location "<path to your clone>"
Get-ChildItem packages -Recurse -Include *.ts -File |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern 'getUiCapability'
```

---

## 5. Does the tool return structuredContent, and does it fit

```powershell
$r = (Invoke-Mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search-products","arguments":{"category":"kurtas","pageSize":24,"pincode":"400013"}}}').result
"has structuredContent : $($null -ne $r.structuredContent)"
"kind                  : $($r.structuredContent.kind)"
"products              : $($r.structuredContent.products.Count)"
"result chars          : $(($r | ConvertTo-Json -Depth 20 -Compress).Length)"
```

Good answer, VERIFIED 2026-09-07 (`kurtas` genuinely has 8 items in the demo catalog, so a
count below `pageSize` is not a bug here):

```
has structuredContent : True
kind                  : search
products              : 8
result chars          : 4748
```

What each bad answer means:

- **`has structuredContent : False`.** The widget will render
  `tool result arrived with no structuredContent`. Every tool result in this codebase goes
  through `result()` in `src/tools/context.ts`, which always returns both `content` and
  `structuredContent`, so a missing one means a handler bypassed the helper. Note that `content`
  is the spec-REQUIRED field and `structuredContent` is optional; returning both is a house rule
  here, not a spec requirement (per the MCP tools specification).
- **`kind` is empty or unrecognised.** `packages/widget/src/main.ts` routes purely on the `kind`
  discriminator, deliberately, because the host does not guarantee to pass the tool name. An
  unrecognised kind falls through to `renderUnknown` and you get
  `Nothing to show for this result.` The known set is `search`, `product`, `cart`, `checkout`,
  `diagnostics`.

### The two payload ceilings

Both are asserted in `src/limits.ts`. They are different in kind and only one of them is loud.

| | Ceiling | What happens | Loud? |
|---|---|---|---|
| **A** | ~25,000 tokens | Budget overrun, the model's context fills. | Visible |
| **B** | ~150,000 characters | claude.ai writes the result to the code-execution sandbox filesystem and hands the app a **file pointer** instead of `structuredContent`. The widget never hydrates. | **Silent. No error anywhere.** |

Ceiling B is the reason `src/limits.ts` exists at all. Ceiling A binds first in practice:
MEASURED at 1.82 characters per token for these payloads against Anthropic `count_tokens` on
2026-09-06, so 25,000 tokens runs out at roughly 45,000 characters, well under 150,000. The
runtime estimate deliberately uses 1.7 chars/token, below the lowest measured value, so it
always over-counts tokens and errs safe.

In development the assertion **throws** `PayloadTooLargeError` at the point of construction. In
production it logs and lets the response through, because a degraded render beats a hard failure
in front of a client. Search the Vercel function logs for:

```
[limits] BREACH
[limits] approaching ceiling:
```

If a list renders empty on claude.ai but the same call is fine locally, check whether production
logged a BREACH that development never reached (the dev path would have thrown first, so you
would have seen it). At the shipped lean shape, 24 products costs 8,135 characters and 4,293
tokens, which is 17.2% of the token budget. You have a lot of room; a breach means something is
wrong with the shape, not with the page size.

**Ceiling B does NOT apply to `resources/read`.** VERIFIED 2026-09-07, gate probe 1: a
441,000-character widget, roughly 3x the threshold, rendered fine on claude.ai. Do not go
looking for a size problem on the resource path. See step 6.

---

## 6. Does resources/read return the real widget

This is the step for a completely empty box.

```powershell
$c = (Invoke-Mcp '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"ui://fashioncart/storefront.html"}}').result.contents[0]
"mime  : $($c.mimeType)"
"chars : $($c.text.Length)"
"head  : $($c.text.Substring(0,60))"
$c._meta | ConvertTo-Json -Depth 6
```

Good answer, VERIFIED 2026-09-07:

```
mime  : text/html;profile=mcp-app
chars : 441000
head  : <!doctype html>
<html lang="en">
  <head>
    <meta charset=
{
  "ui": {
    "csp": {
      "resourceDomains": ["https://<your-mcp-project>.vercel.app"],
      "connectDomains":  ["https://<your-mcp-project>.vercel.app"]
    },
    "prefersBorder": false
  }
}
```

Check each field. Every one of them is a distinct failure.

### The MIME type

It must be **exactly** `text/html;profile=mcp-app`. One token. **No space after the semicolon.
A semicolon, not a plus.** `text/html; profile=mcp-app` and `text/html+mcp-app` are both wrong
and both fail silently: the host does not recognise the resource as an MCP App and renders
nothing.

Never type the string. Import it:

```ts
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
```

FROM SOURCE: `registerAppResource(server, name, uri, config, cb)` expands to
`server.registerResource(name, uri, { mimeType: RESOURCE_MIME_TYPE, ...config }, cb)`. Your
`config` is spread **after** the default, so passing your own `mimeType` in the config object
silently overrides the correct one. `text/html+skybridge` is the retired ChatGPT MIME and is
behind `ENABLE_CHATGPT_MIME`, off by default. If you see it on the primary registration,
someone turned that flag on.

Cross-check the listing too, since a resource can be registered correctly and listed wrongly:

```powershell
(Invoke-Mcp '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}').result.resources |
  ForEach-Object { "{0}  mime={1}" -f $_.uri, $_.mimeType }
```

### The character count

- **Around 400 characters, and the head says `<!-- widget bundle not built yet -->`.** You got
  `PLACEHOLDER_HTML`. The server could not read `mcp-app.html`. Go to
  [step 2b](#2b-the-staged-widget-copy-is-older-than-the-built-one). On Vercel this also means
  `data/widget/mcp-app.html` was never staged, so `npm run predeploy` did not run or ran before
  the widget was built. `scripts/copy-data.mjs` treats the widget as **optional** and only
  warns: look for `[stage] SKIP` in the build output.
- **Hundreds of thousands of characters.** Correct. Not a problem. The 150,000-character
  ceiling is a tool-result limit, not a resource limit. VERIFIED 2026-09-07.
- **Zero.** The read callback returned an empty string. Check `readWidgetHtml` in
  `src/mcp-server.ts` and `config.widgetDistDir`.

### The CSP block

`_meta.ui.csp` must be on the **`contents[]` entry returned by the read callback**, not on the
`registerAppResource` config object. Placement matters: the entry-level `_meta` takes precedence
over listing-level `_meta`. In this codebase it is correct, in `src/mcp-server.ts`, on the
object inside `contents`. If you see the CSP on the config object instead, that is the bug.

Directive mapping:

| `_meta.ui.csp` key | Feeds |
|---|---|
| `resourceDomains` | `img-src`, `script-src`, `style-src`, `font-src`, `media-src` |
| `connectDomains` | `connect-src` |
| `frameDomains` | `frame-src` |
| `baseUriDomains` | `base-uri` |

VERIFIED on claude.ai 2026-09-07, gate probe 2: `resourceDomains` **does** reach `img-src`. A
plain `<img>` at our own origin displayed at 320x400 in 1098ms. This refutes ext-apps issue
**#761** (2026-08-27), which reported that `resourceDomains` had no effect on `img-src` in
claude.ai web. Corroborated by probe 5: the host echoes the declaration straight back in
`getHostCapabilities()` under `sandbox.csp`, listing both domains, so it is reporting that it
applied it rather than merely accepting it. If you find yourself designing around #761, stop:
it did not reproduce.

An **empty** `resourceDomains` array is the real failure. `cspFor()` only adds an origin that
matches `/^https?:\/\//`, so a malformed `publicUrl` produces `[]` and every image is blocked.
Go back to step 3 and look at `publicUrl`.

### `'self'` never means your deployment

The view is created by `document.write(html)` into an inner iframe on the **host's** sandbox
origin. On claude.ai that origin is `https://<32 hex>.claudemcpcontent.com`. The value observed
during the gate run on 2026-09-07 was
`https://ebba60c5bee818fc40f7298e4a9d0e11.claudemcpcontent.com`.

So `'self'` in the enforced CSP resolves to the sandbox origin, and images served from your own
domain are **cross-origin** from inside the view. They must be listed in `resourceDomains`.
There is nothing you can do to make `'self'` mean your deployment.

You cannot precompute the hash. An earlier draft of the research notes recorded, as
CONFIRMED, that it is the first 32 hex characters of the SHA-256 of the full connector URL.
**That was tested and withdrawn**: MD5, SHA-1, SHA-256 and SHA-512 across four URL forms, taking
both the first and last 32 hex characters, produced no match. The derivation is unknown. If you
ever need the value (for `_meta.ui.domain`, say) you must read it from a live probe, and
`run-diagnostics` prints it.

---

## 7. Does the widget mount

If steps 3 to 6 are all good, the server has done its job. Everything from here is inside the
host.

Fastest way to separate "our HTML is broken" from "the host is not delivering it": run the
bundle with no host at all.

```powershell
Set-Location ".\packages\widget"
npm run build
Start-Process "$PWD\dist\preview.html"
```

The standalone preview escape hatch exists precisely for this. `src/main.ts` sets a 1200ms
timer: if nothing has arrived from a host and `window.__FASHIONCART_PREVIEW__` is set, it renders
that payload instead. So the preview needs no Claude account and no tunnel.

- **The preview renders.** The bundle is fine. The problem is host delivery or the connection.
  Go to step 8.
- **The preview is blank too.** The bundle is broken. Open the browser devtools console on
  `preview.html` and read the first error. A JavaScript exception during module evaluation
  produces exactly the symptom in the title of this document: an empty box and nothing anywhere
  else.

Second-fastest: the vendored local harness, which is a real host implementing the same protocol,
so it isolates "claude.ai specifically" from "any host".

```powershell
Set-Location "<path to your clone>"
.\scripts\host.ps1
# host UI on http://localhost:8080, sandbox origin on http://localhost:8081
```

Widget console events in the harness are prefixed `[HOST]`. Note the harness is the **control**,
not the target: a divergence between the harness column and the claude.ai column is itself the
finding. That is how #761 was settled.

Third option, for tool-level work rather than rendering:

```powershell
npx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method tools/list
```

See `docs/INSPECTOR.md`. Two things there will bite: the target URL **must come first**, before
any flag, or it is silently discarded; and the web UI needs the tokenised URL it prints, because
typing `localhost:6274` by hand 401s.

### Height and backdrop

Neither of these produces a blank box, but both produce a box that looks wrong.

- Claude reads the document height directly and is reported to ignore
  `ui/notifications/size-changed`. `bridge.reportHeight()` therefore sets an explicit
  `documentElement.style.height` **and** sends the notification. If content is clipped, the
  explicit height is the one that matters.
- `containerDimensions` on claude.ai web measured `{ maxHeight: 5000, width: 735.98 }` on
  2026-09-07. That is far more generous than the "inline height cap" warning implies. A 24-card
  grid fits without requesting fullscreen. Only `inline` and `fullscreen` are offered; there is
  no `pip`.
- An opaque white panel behind the card in dark mode means `<meta name="color-scheme" content="light dark">`
  or the transparent `html`/`body` rule went missing from `mcp-app.html`. VERIFIED working
  2026-09-07, gate probe 8.

---

## 8. Does the widget connect to the host

This is the step for a box stuck on `Loading FashionCart...`.

### Handlers must be assigned BEFORE app.connect()

Handlers registered after `connect()` never fire. This is the single most commonly reported
cause of a widget that mounts and then sits empty, and it is exactly the symptom above: the
bundle ran, the DOM mounted, `Loading` is on screen, and `ontoolresult` never arrives because
the host already sent it.

`src/bridge.ts` `start()` does it correctly and the ordering there is load-bearing, not
stylistic: `ontoolresult`, `onhostcontextchanged` and `onteardown` are all assigned, and
`await this.app.connect()` is the last statement. If you refactor that method, keep `connect()`
last.

**You do not have to guess.** FROM SOURCE (`ext-apps` 1.7.5): the SDK ships a guard,
`_assertHandlerTiming`, that logs this exact string to the console:

```
[ext-apps] "toolresult" handler registered after connect() completed the ui/initialize handshake. The host may have already sent this notification. Register handlers before calling app.connect().
```

It covers the four one-shot events only: `toolinput`, `toolinputpartial`, `toolresult`,
`toolcancelled`. To turn the warning into a hard failure while debugging, construct the app in
strict mode:

```ts
new App({ name: "FashionCart", version: "0.1.0" }, {}, { strict: true })
```

There is a companion guard for the other direction. Calling a bridge method before the handshake
completes logs:

```
[ext-apps] App.callServerTool() called before connect() completed the ui/initialize handshake. Await app.connect() before calling this method, or move data loading to an ontoolresult handler.
```

And connecting twice throws `App is already connected. Call close() before connecting again.`

### Read the host's own answers

`run-diagnostics` renders these on screen, which is why it exists. Baseline values from the gate
run on claude.ai web, 2026-09-07:

```json
{
  "openLinks": {},
  "downloadFile": {},
  "serverTools": { "listChanged": true },
  "serverResources": { "listChanged": true },
  "logging": {},
  "sandbox": { "csp": { "connectDomains": ["https://<your-mcp-project>.vercel.app"],
                        "resourceDomains": ["https://<your-mcp-project>.vercel.app"] } },
  "updateModelContext": { "text": {}, "image": {} },
  "message": { "text": {} }
}
```

```json
{
  "theme": "light",
  "displayMode": "inline",
  "availableDisplayModes": ["inline", "fullscreen"],
  "locale": "en-US",
  "timeZone": "Asia/Calcutta",
  "safeAreaInsets": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
  "containerDimensions": { "maxHeight": 5000, "width": 735.984375 },
  "styleVarCount": 76
}
```

Compare against those. `sampling` is **absent** and always has been; do not design around it.
`downloadFile` **is** present on web, unlike an earlier report about iOS.

Never branch on a host or product name. `bridge.can` queries `getHostCapabilities()`, which is
the supported way and is also what OpenAI's own guidance instructs. A host-name branch will
break silently the moment a host renames itself.

---

## 9. Do the images load

Symptom: cards render, every image is the same grey placeholder.

`withImageFallback` in `packages/widget/src/format.ts` runs a three-rung ladder and the rungs
depend on **different CSP directives**, which is what makes the fallback a config change rather
than a redesign:

| Rung | Mechanism | Needs |
|---|---|---|
| 1 | plain `<img src>` at our origin | `resourceDomains` widening `img-src` |
| 2 | `fetch()` then `URL.createObjectURL()` | `connectDomains` widening `connect-src`, plus `blob:` which is in the default |
| 3 | inline SVG placeholder | nothing |

Reaching rung 3 means rungs 1 and 2 **both** failed. Diagnose in this order:

1. **Is the image actually served?** From the sweep in step 1, the `image :` line should be
   `HTTP 200`. If it is 404, the problem is not CSP at all. Note that `express.static()` is
   ignored on Vercel: images are served from `public/**` by the CDN. If they work locally and
   404 in production, the files are not under `packages/mcp-server/public/images/`.
2. **Is `resourceDomains` populated and correct?** Step 6. An empty array or the wrong origin is
   the usual cause, and it traces back to `publicUrl` in step 3.
3. **Is the URL the widget builds the URL you tested?** The widget derives thumbnails from
   `envelope.imageBaseUrl` plus `envelope.thumbnailTemplate` (`/images/{id}/thumb.webp`), not
   from a per-product field. That economy is worth 29% of the token cost, but it means a wrong
   `imageBaseUrl` breaks every image at once while the payload still looks perfectly healthy.

If rung 1 fails but rung 2 works, you have found a genuine claude.ai regression against the
gate-run baseline. Both rungs were PASS on 2026-09-07. Record it before changing anything.

Do not reach for data-URI thumbnails. MEASURED against the real 60-SKU catalog: at the median
real thumbnail of 9,841 bytes, a 24-product page is 323,615 characters, which is 685% of the
token ceiling and 216% of the character ceiling. It is ruled out by measurement, not preference.

---

## 10. Does the cart survive, and does checkout hand off

### There is no ambient cart

Every cart tool takes an explicit `cartId`. There is no "current cart" and no module-level
mutable default, and that is a correctness requirement rather than tidiness.

The reason inverts the usual serverless assumption. On Vercel **Fluid compute, module scope IS
shared** between concurrent invocations on one instance, deliberately. So a module-level
"current cart" would not merely be lost between requests, it would **leak between users**. And
module scope does **not** persist across instances, so a cart minted on one instance is
invisible to another and can appear to vanish mid-conversation.

Both halves matter for diagnosis:

- **`Cart "<id>" not found or expired`** partway through a demo, with the id looking correct.
  Most likely the request landed on a different instance. `InMemoryCartStore` is per-instance
  by construction. It is fine for a single-presenter demo and nothing else. The fix is
  `RedisCartStore`, which is deliberately left unimplemented (it throws a clear error) rather
  than stubbed as a working-looking no-op, precisely so choosing it without a client fails
  loudly.
- **A cart containing someone else's lines.** Something introduced ambient cart state. Grep for
  a module-level cart or a defaulted `cartId` in `src/tools/cartTools.ts`.

`InMemoryCartStore` also evicts on access: 6 hour TTL, 1000-cart cap, oldest first. A cart that
disappears after a long break is that, not a bug.

### The "Open external link" modal is not a bug

VERIFIED directly on 2026-09-07, gate probe 7, on a third confirming pass. Calling
`app.openLink({url})` on a **custom (non-directory) connector** always shows a confirmation
modal, verbatim:

> **Open external link**
> You're leaving Claude to visit an external link:
> `https://<your-mcp-project>.vercel.app/health`
> [ Cancel ]  [ Open link ]

Two details that matter and that the research did not predict:

1. **There is no "always allow" option.** Cancel and Open link only. The modal therefore appears
   on **every** handoff, not once per domain per session. The presenter will see it every single
   time they run the checkout flow.
2. **It displays the full destination URL** in a small scrollable field, with Cancel holding
   initial focus.

Only Directory-listed connectors can allowlist destinations to skip it. Clicking through does
open a real tab, so a resolved promise plus no visible tab means the user cancelled.

Point 2 has a design consequence, not a defect: the signed checkout token makes the URL a wall
of base64, shown in a "you are leaving Claude" dialog at the moment of handoff. Shortening the
link (for example, a short server-side handle in place of the full token) is an open design choice.

---

## Vercel build and deploy failures, by exact error string

All five were hit for real on this project.

### `Command "npm run build" exited with 1`

Caused by `.vercelignore` hiding `tsconfig.build.json`. The build script runs
`tsc -p tsconfig.build.json`, the file was excluded from the upload, and the builder failed with
nothing more specific than the line above.

**Config files the build reads must ship.** `.vercelignore` now carries a comment saying exactly
this. Do not add `tsconfig*.json` to it.

### `No entrypoint found. Searched for: app|index|server...`

The Express framework preset looks for an entrypoint at exactly these six shapes and nowhere
else:

```
app|index|server.{js,cjs,mjs,ts,cts,mts}
src/app|src/index|src/server.{js,cjs,mjs,ts,cts,mts}
```

`api/index.ts` is **not** on that list. The entrypoint is `src/index.ts` and `vercel.json`
names it under `functions`. If you move it, move both.

**Documentation drift, worth knowing before it costs you an hour.** `docs/DEPLOY.md` still lists
`api/index.ts` in its "what is already configured" table, and the header comments in
`src/http-app.ts` and `src/main.ts` still refer to `api/index.ts` and to an `app.ts` that is
now `http-app.ts`. Resolved by reading the code: `vercel.json` names `src/index.ts`, `src/index.ts`
exists and carries the full explanation, and there is no `api/` directory in the package. The
code is authoritative; those three comments are stale.

### `No entrypoint found which imports express. Found possible entrypoint: src/index.ts`

The check is static and it is not satisfied by a re-export. The entrypoint must `import express`
**directly** and use it. That is why `src/index.ts` builds a one-line root app rather than just
re-exporting `createApp`:

```ts
import express from "express";
const root = express();
root.use(createApp(catalog, carts, config));
export default root;
```

That is not ceremony. Deleting it breaks the deploy.

### ENOENT on catalog.json

`node:fs` reads are **not import-traced**, so the bundler has no way to know the feed is needed
and drops it. The function then throws ENOENT at cold start. Fixed by
`functions."src/index.ts".includeFiles` in `vercel.json`.

Two constraints on that key:

- **`includeFiles` is a single glob string, not an array.** `"data/**"` is correct.
- **It only reaches paths inside the function root**, which is `packages/mcp-server`. The
  authored feed lives at the repo root and the widget bundle in a sibling package, so
  `scripts/copy-data.mjs` stages both under `./data` in order that one glob covers them. That is
  why the widget ends up at `data/widget/mcp-app.html`, which is odd naming for a clean
  guarantee.

Symptom in the sweep: `/health` returns `products : 0`, or the function 500s at cold start.

### `express.static()` is ignored on Vercel

The `/images` route in `src/http-app.ts` is dead in production. Files under
`packages/mcp-server/public/**` are served by the CDN instead, which is also what keeps image
bytes away from the 4.5 MB function **response** limit. The route is kept only so local dev and
production expose the same paths.

Images that work locally and 404 in production are in the wrong directory.

### A plain `.env` IS uploaded

Vercel's default ignore list contains only `.env.local` and `.env.*.local`. A plain `.env` ships,
and deployment source is readable. `.vercelignore` excludes `.env`, `.env.production` and
`.env.*` explicitly. Do not remove those lines.

### Other Vercel notes worth having to hand

- **The first deploy of a new project is a PRODUCTION deploy**, even without `--prod`. There is
  no throwaway smoke-test push.
- **`vercel env add` is sensitive-by-default** for production and preview. You cannot read the
  value back afterwards, only overwrite it. Keep your own copy of `CHECKOUT_SECRET`. If you lose
  it and rotate it, every in-flight checkout link is invalidated, which is correct behaviour but
  looks like a broken handoff.
- `CHECKOUT_SECRET` is required in production. `loadConfig()` throws
  `CHECKOUT_SECRET must be set in production. Without it, checkout links could be forged.` and
  the function will not start.
- No `runtime` key (that is for community runtimes only), no `memory` key (it cannot be set in
  `vercel.json` while Fluid compute is on), and Node is pinned via `engines.node` in
  `package.json` because `vercel.json` has no `nodeVersion` key.

---

## Windows and PowerShell traps

Every one of these has actually broken a command on this machine. Upstream MCP documentation is
written in bash fences throughout, and several examples are hard parse errors here.

| Trap | Symptom | Do this instead |
|---|---|---|
| `npm.ps1` blocked by execution policy | `npm : File ...\npm.ps1 cannot be loaded because running scripts is disabled on this system.` | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` for the session, or call the `.cmd` shim (`npm.cmd`, `npx.cmd`) |
| `<` input redirection | `The '<' operator is reserved for future use.` This kills `vercel env add X production < file` | Use the interactive prompt. It also keeps the secret out of PowerShell history |
| `printf` | `printf : The term 'printf' is not recognized` | `Add-Content -Path .vercelignore -Value '.env'` |
| `>` file redirection | Writes a UTF-8 **BOM** that corrupts a URL when read back, so `vercel ... > url.txt` yields an unusable URL | `Out-File -Encoding utf8NoBOM`, or `Set-Content -Encoding ascii`, or just read the URL off the terminal |
| bash env prefixes | `SERVERS='[...]' npm start` is a parse error | `$env:SERVERS = '[...]'` on its own line. `scripts\host.ps1` already does this |
| `ConvertTo-Json` on a one-element array | Serialises to a bare string, so `serve.ts` parses a string where it wants an array. `-AsArray` does not exist in Windows PowerShell 5.1 | Build the JSON by hand, as `scripts\host.ps1` does |
| PowerShell 5.1 has no `&&`, `\|\|`, `?:`, `??`, `?.` | Parser errors | `;` plus `if ($?) { }` |
| `2>&1` on a native exe | Wraps stderr lines in `NativeCommandError` and sets `$?` to false even on exit code 0 | Do not redirect; stderr is captured already |

The Python scripts in `scripts/` need Python 3.10 or later and Pillow; the token-counting and
evaluation scripts also need the `anthropic` package. Keep scratch and test artefacts inside the
project directory.

---

## Things that look broken and are not

Confirming these before chasing them saves the most time of anything on this page.

- **The "Open external link" modal on every handoff.** VERIFIED 2026-09-07. Expected for a
  custom connector, no "always allow" option exists, see [step 10](#the-open-external-link-modal-is-not-a-bug).
- **A browser GET to `/mcp` returns 406.** VERIFIED 2026-09-07. Correct. Use `/health`.
- **`initialize` does not echo the UI extension back.** Correct: `extensions` is a client-side
  declaration and the core spec has no extension-version negotiation.
- **`Searched available tools > FashionCart run diagnostics` in the transcript before the call.**
  That is the host-side tool_search path. Normal at eight tools; a reason not to grow the count
  carelessly.
- **Claude asks permission on first render.** Per app, with an "Always allow" option. A widget
  can fail to appear simply because permission was never granted. Check that before debugging
  anything.
- **The host echoes your CSP back under `sandbox.csp`.** That is confirmation it applied the
  declaration, not a leak.
- **`resources/read` returning 400,000+ characters.** Fine. The 150,000-character ceiling is a
  tool-result limit only. VERIFIED 2026-09-07.
- **The widget shows fewer products than `pageSize`.** The demo catalog is 60 SKUs across six
  categories; `kurtas` genuinely returns 8.
- **`_meta` carrying both `ui.resourceUri` and `ui/resourceUri`.** The SDK writes both. VERIFIED
  2026-09-07.
- **ext-apps issue #761.** Did not reproduce on 2026-09-07. Do not design around it.

---

## What this document has not checked

Stated up front so a future reader does not mistake silence for coverage.

- **Every host observation here is claude.ai web, desktop browser, one session, 2026-09-07.**
  Claude Desktop and the mobile apps have never been tested against this connector. The Phase 1
  research carries two SUSPECTED reports worth remembering if you ever go there: Claude Desktop
  on macOS delivering `tool-result` with no `structuredContent` (`src/bridge.ts` already surfaces
  that case rather than rendering an empty shell), and iOS not implementing `ui/download-file`.
  Neither has been reproduced by us.
- **`getUiCapability` is not wired into this server.** There is no graceful-degradation path to
  test, and no server-side signal that a client did or did not declare the UI extension.
- **The ChatGPT MIME registration has never been exercised.** `ENABLE_CHATGPT_MIME` is off by
  default and was never turned on against a real ChatGPT client.
- **`RedisCartStore` is unimplemented by design.** Anything beyond a single-presenter demo needs
  it written.
- **The merchant site and the end-to-end checkout resume are out of scope here.** This file stops
  at the `openLink` call.
- **GET and DELETE semantics on `/mcp` are unresolved.** Early research notes
  stated that on the stateless path both are answered `405`. Measured locally on 2026-09-07: a
  GET without an `Accept` header returns 406, and a DELETE returned 200 with an empty body.
  Provenance not resolved, and it is not load-bearing, because claude.ai only POSTs. Do not treat
  either observation as a defect on the strength of this note.
- **The 441,000-character figure is the gate-run measurement**, not a current reading. The widget
  source was actively being edited on 2026-09-07 and `dist` had already moved to 452,606 bytes.
  Measure it rather than quoting it.
