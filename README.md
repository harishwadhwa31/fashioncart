# FashionCart

FashionCart is a **fictional clothing retailer**: its products, prices, stock and store
locations are invented, and its checkout takes no payment and ships nothing. The integration
is real, though, and it works. FashionCart runs inside an AI assistant such as Claude as an
[MCP](https://modelcontextprotocol.io) connector. The shopper asks in plain language, the
assistant calls the store's tools, and the store's own product grid renders in the
conversation, where the shopper can filter, pick a size and add to bag. At checkout, the
assistant hands off to the store's own website with a signed, short-lived link, so the
payment step never passes through the assistant.

**Live demo:**

- Storefront: https://fashioncart-merchant.vercel.app
- Claude connector URL: `https://fashioncart-mcp.vercel.app/mcp` (setup steps at
  https://fashioncart-merchant.vercel.app/connect)

**Demo video:** `<link to be added>`

## Architecture

```
 Shopper ──> AI assistant (e.g. Claude)
                │  MCP over Streamable HTTP (POST /mcp)
                ▼
        packages/mcp-server ──── data/catalog.json, data/fulfilment.json
          • 8 tools                      (the invented catalogue)
          • 1 UI resource: ui://fashioncart/storefront.html  ◄── packages/widget
          • /images  (product images)
                │  checkout returns a signed link (HMAC, expires in 15 min)
                ▼
        packages/merchant   (the store's own website: product pages, checkout, mock payment)
```

| Package | What it is |
| --- | --- |
| `packages/mcp-server` | The MCP server. Stateless Streamable HTTP on `/mcp` (MCP 2025-11-25), plus `/health` and `/images`. Deploys to Vercel as one Express function. |
| `packages/widget` | The in-chat storefront, built with Vite into one self-contained HTML file and served by the MCP server as an [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) UI resource. |
| `packages/merchant` | The store's own website. It verifies the signed checkout link, re-prices the cart from the catalogue, and runs a demonstration payment step that collects no payment details. |
| `packages/host-harness` | A vendored copy of the MCP Apps reference host, for testing the widget locally without an assistant. |
| `data/` | The invented catalogue (60 products) and fulfilment data. `SCHEMA.md` documents the format. |

### Tools

| Tool | What it does |
| --- | --- |
| `search-products` | The default tool for any shopping request. Searches and filters the catalogue (text, category, price range, size, colour, in-stock, sort, delivery pincode) and returns a page of results, which the widget renders as a product grid. |
| `get-product-details` | The full record for one product: long description, fabric and care, colours, stock per size, gallery, and delivery availability for a pincode. |
| `add-to-cart` | Adds one product in one size. Returns a `cartId` that every later cart call needs. |
| `set-quantity` | Sets the exact quantity of a line already in the cart (0 removes it). |
| `remove-from-cart` | Removes a line from the cart. |
| `get-cart` | Returns the cart re-priced from the live catalogue: lines, subtotal, member discount, delivery and total. |
| `checkout` | Re-prices the cart and returns a short-lived, signed link to the merchant site, where the shopper enters delivery details and completes the demonstration payment. |
| `run-diagnostics` | Troubleshooting only: renders a card that reports what the host allows (image loading, sandbox origin, capabilities, external links). |

### How an assistant consumes it

1. The assistant connects to `https://<host>/mcp` and lists the tools. Each tool's description
   tells the model when to use it.
2. When the shopper asks for something, the model calls a tool. The result carries both text
   for the model and `structuredContent` for the UI.
3. Each tool declares the UI resource `ui://fashioncart/storefront.html` in its `_meta`. A host
   that supports MCP Apps renders that resource in a sandboxed frame and passes it the tool
   result, so the product grid appears in the conversation. The widget can call tools itself
   (filter, add to bag) and asks the host to open external links.
4. `checkout` returns a link to the merchant site. The host asks the shopper before opening it,
   and the merchant site verifies the link's signature before showing the order.

Prices are always computed on the server from the catalogue. The model is instructed never to
add up prices itself, and neither the assistant nor the widget ever handles payment details.

Carts are held in memory (`InMemoryCartStore`), which suits a demo and local development. A
production deployment needs a shared store; `RedisCartStore` is left as an interface stub.

## Quickstart

Requires Node.js 24 and npm.

### 1. Install

```bash
npm install
```

### 2. Environment variables

Local development needs none: both servers fall back to local defaults, and checkout links
are signed with a built-in development secret. For deployment, see `.env.example`; the
important ones are:

| Variable | Set on | Purpose |
| --- | --- | --- |
| `CHECKOUT_SECRET` | both | Signs and verifies checkout links. Must be identical on both. Required in production. |
| `MERCHANT_URL` | MCP server | Where checkout links point. |
| `IMAGE_BASE_URL` | merchant | Where product images are served (the MCP server's URL). |
| `FC_MCP_URL` | merchant | The connector URL shown on the site's `/connect` page. |

### 3. Run locally

```bash
# Terminal 1: builds the widget, then starts the MCP server on http://localhost:3001
npm run dev

# Terminal 2: the merchant site on http://localhost:3002
npm --prefix packages/merchant run dev
```

Check it is up: `http://localhost:3001/health` should report 60 products.

Tests:

```bash
npm test                                   # MCP server unit tests
npm --prefix packages/merchant run smoke   # merchant end-to-end smoke test
```

To try the widget without an assistant, run the reference host in `packages/host-harness`
(on Windows: `npm run harness`; elsewhere: `SERVERS='["http://localhost:3001/mcp"]' npm start`
inside that folder).

### 4. Connect to Claude

Claude reaches a connector over the public internet, so the MCP server needs an HTTPS URL.

1. **Deploy** both parts to Vercel as two projects (see `docs/DEPLOY.md`):
   - from the repository root, `npm run deploy` builds the widget and deploys
     `packages/mcp-server`;
   - from `packages/merchant`, `npm run deploy` deploys the merchant site.

   Set the environment variables above on each project. The deploy scripts copy `data/` into
   each package before uploading.
2. **Add the connector** in Claude: in the connector settings, add a custom connector with the
   URL `https://<your-mcp-project>.vercel.app/mcp`. Custom connectors are available on Claude
   plans that support them.
3. **Ask** in a new chat with the connector turned on, for example: *Show me linen clothes
   under 3000*.

`docs/TROUBLESHOOTING.md` covers what to check when the grid does not render or a tool is not
called.

## Repository notes

- `scripts/` holds optional Python tools for regenerating the catalogue and images and for
  measuring payload sizes. None are needed to run the app.
- Product images are either Pexels photographs reviewed for brand marks or plain generated
  placeholders; see `packages/mcp-server/public/images/README.md`.

## Licence

MIT, see `LICENSE`. The vendored host harness and the Pexels photographs keep their own
licences, as noted there.
