# FashionCart merchant storefront

The mock merchant site a shopper lands on after an AI assistant hands off. It resumes the cart
from a signed token, re-prices everything server side, takes a delivery address, runs a clearly
labelled mock payment step, and confirms the order.

Server rendered HTML from small template functions. No React, no view engine, no CSS framework,
and one runtime dependency: Express.

## Run it

```bash
npm install          # once
npm run dev          # http://localhost:3002
```

`npm run dev` prints a working checkout link for a Gold member cart, so the checkout, payment and
confirmation pages can be exercised without running the MCP connector alongside.

```bash
npm run typecheck    # tsc --noEmit
npm run smoke        # boots the app and walks the whole flow, about 60 assertions
npm run build        # tsc to dist/
npm start            # node dist/main.js
```

## Pages

| Route | What it does |
| --- | --- |
| `GET /` | Landing page. `?category=<slug>` filters it, which is what the header nav links to. |
| `GET /product/:id` | Product detail: gallery, colours, sizes with sold out ones disabled, attributes, photographer credit. Friendly 404 for an unknown id. |
| `GET /checkout?token=` | Resumes the cart from the token. Line items, address form, order summary. |
| `POST /payment` | Validates the address, then shows the amount and one button. |
| `POST /payment/confirm` | Re-verifies, re-prices, writes the order, redirects. |
| `GET /order/:id` | Confirmation. |
| `GET /health` | `{ ok: true, products: 60 }` |

## The three rules this code exists to demonstrate

**1. No payment data.** No card number, CVV, UPI handle or any other instrument is collected,
stored, logged, or present as an unused input. Two independent reasons, spelled out at the top of
`src/routes/payment.ts`: payment data localisation, and keeping PCI DSS scope with the
merchant. `npm run smoke` asserts that no form control anywhere in the flow looks like a payment
field.

**2. Prices are never trusted from the wire.** The token carries product ids, sizes and
quantities. It carries no money. `src/pricing.ts` recomputes every figure from the catalog on the
checkout page, again on the payment page, and again inside the confirm request before the order
is written.

**3. The statement adds up.** Subtotal is printed BEFORE the member discount, the discount is its
own line, delivery is its own line, and the total is their sum. `priceCart()` asserts
`listSubtotal - memberDiscount + deliveryFee === total` and throws rather than render a statement
that does not balance. The smoke test additionally checks that the visible line items sum to the
subtotal on both the checkout and confirmation pages.

Money is integer rupees throughout. `formatRupees()` throws on a non integer rather than print a
rounding artefact, and groups digits the Indian way: `Rs 1,23,456`.

## Checkout token

Minted by the MCP connector, verified here. Same scheme on both sides:

```
<base64url(JSON payload)>.<base64url(HMAC-SHA256(body, secret))>
```

The signature covers the base64url body string, not the raw JSON. Payload:

```jsonc
{ "cid": "cart id", "l": [["FC-SHT-001", "M", 2]], "p": "400013", "m": "gold-demo",
  "iat": 1788726290, "exp": 1788727190 }
```

Verified with `crypto.timingSafeEqual`. Rejected when it is not two parts, when the signature
does not match, or when `exp` has passed. Each rejection renders its own page explaining what to
do: 400 for a bad link, 410 for an expired one, 409 when nothing in the bag is still available.

The scheme is duplicated rather than imported, because the two deployments must not share a build.
The authoritative copy is `packages/mcp-server/src/checkout/token.ts`; a change there is a
breaking change here.

Member ids: `gold-demo` gives 10% off, `silver-demo` 5%, rounded per unit then multiplied so this
site and the assistant quote the same figure. Delivery is free at or above Rs 1,499, otherwise
Rs 99, tested against the post discount subtotal on both sides.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3002` | Local dev only. |
| `CHECKOUT_SECRET` | `dev-only-insecure-checkout-secret` | Must match the connector. Set it in production. |
| `IMAGE_BASE_URL` | `https://<your-mcp-project>.vercel.app` | Images are served by the other deployment; this site ships no image bytes. |
| `DATA_DIR` | resolved | Overrides feed lookup. |

## Data

`../../data/catalog.json`, read with `node:fs` at startup and validated before use. `discountPct`
is derived at load and never stored. `../../data/fulfilment.json` is optional and supplies the
city specific delivery estimate; without it every order quotes the national default.

A Vercel function root is this package, so `npm run predeploy` stages both files into `./data`,
which is what `vercel.json`'s `includeFiles` picks up. The staged copy only wins when `VERCEL` is
set, so it can never shadow a local edit to the authored feed.

## Deploy notes

Vercel's Express preset checks, statically, that `src/index.ts` imports express directly and uses
it. Re-exporting an app built elsewhere fails with "No entrypoint found which imports express".
The app is therefore assembled in `src/index.ts` and default exported; `src/main.ts` only adds a
listener for local development.

All relative imports carry an explicit `.js` extension. Required by NodeNext and by the build.

## House style

No em dashes and no en dashes in anything a shopper reads. `npm run smoke` greps the rendered HTML
of every page for both and fails on either. Amounts are written `Rs 1,299`, never with the rupee
glyph.

Every brand, product, price and photograph credit in the feed is fictional or licensed stock. No
real retailer is named anywhere.
