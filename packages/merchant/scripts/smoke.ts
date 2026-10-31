/**
 * End to end smoke test. Boots the real app on an ephemeral port and walks the whole flow.
 *
 * Lives outside src/ on purpose: tsconfig compiles src/ into the deployment bundle, and a test
 * that boots a server has no business shipping to production.
 *
 * Run it with `npm run smoke`. It asserts the things that are expensive to notice late:
 * the money statement balancing on every page that prints it, member pricing rounding per unit,
 * each token rejection rendering a friendly page with the right status, and the two house rules
 * (no payment instrument anywhere in a form, no em or en dashes in rendered text).
 */
import app from "../src/index.js";
import { catalog } from "../src/catalog.js";
import { groupIndian, priceCart, formatRupees } from "../src/pricing.js";
import { mintCheckoutToken, verifyCheckoutToken } from "../src/token.js";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) {
    failures++;
    console.log("FAIL  " + name + (extra ? "  :: " + extra : ""));
  } else {
    console.log("ok    " + name);
  }
}

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as any).port;
const base = "http://127.0.0.1:" + port;

async function get(path: string) {
  const r = await fetch(base + path, { redirect: "manual" });
  return { status: r.status, body: await r.text(), loc: r.headers.get("location") };
}
async function post(path: string, form: Record<string, string>) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    redirect: "manual",
  });
  return { status: r.status, body: await r.text(), loc: r.headers.get("location") };
}

// --- money formatting -------------------------------------------------------
check("groupIndian 1499", groupIndian(1499) === "1,499", groupIndian(1499));
check("groupIndian 123456", groupIndian(123456) === "1,23,456", groupIndian(123456));
check("groupIndian 12345678", groupIndian(12345678) === "1,23,45,678", groupIndian(12345678));
check("formatRupees", formatRupees(1299) === "Rs 1,299", formatRupees(1299));
let threw = false;
try { formatRupees(12.5); } catch { threw = true; }
check("formatRupees rejects float", threw);

// --- basic pages ------------------------------------------------------------
const health = await get("/health");
check("health 200", health.status === 200, String(health.status));
check("health products", JSON.parse(health.body).products === catalog.products.length, health.body);

const home = await get("/");
check("home 200", home.status === 200);
check("home wordmark", home.body.includes("FashionCart"));
check("home featured", home.body.includes("Featured styles"));
check("home links a product", /href="\/product\/FC-/.test(home.body));

const cat = await get("/?category=kurtas");
check("category 200", cat.status === 200);
check("category heading", cat.body.includes("Kurtas"));

const p0 = catalog.products[0];
const pdp = await get("/product/" + p0.id);
check("pdp 200", pdp.status === 200);
check("pdp name", pdp.body.includes(p0.name));
check("pdp mrp struck", pdp.body.includes("class=\"mrp\""));
check("pdp credit", p0.credit.source === "generated"
  ? pdp.body.includes("Placeholder image generated for this demo")
  : pdp.body.includes(p0.credit.author));
{
  // Cover the other credit kind too, so both renderings stay tested.
  const other = catalog.products.find((p) => (p.credit.source === "generated") !== (p0.credit.source === "generated"));
  if (other) {
    const page = await get("/product/" + other.id);
    check("pdp credit (other kind)", other.credit.source === "generated"
      ? page.body.includes("Placeholder image generated for this demo")
      : page.body.includes("Photograph by " + other.credit.author));
  }
}
check("pdp colour hex", pdp.body.includes(p0.colours[0].hex));

// a product with at least one sold-out size, to prove disabled rendering
const withSoldOut = catalog.products.find((p) => p.inStockSizes.length < p.sizes.length);
if (withSoldOut) {
  const r = await get("/product/" + withSoldOut.id);
  check("sold-out size disabled", r.body.includes("disabled aria-disabled=\"true\""), withSoldOut.id);
}

const missing = await get("/product/FC-DOES-NOT-EXIST");
check("pdp 404", missing.status === 404);
check("pdp 404 friendly", missing.body.includes("cannot find that style") && !missing.body.includes("at Object."));

// --- token rejections -------------------------------------------------------
check("checkout no token", (await get("/checkout")).status === 400);
check("checkout garbage", (await get("/checkout?token=abc")).status === 400);

const goodBody = mintCheckoutToken({ cid: "c1", l: [[p0.id, p0.inStockSizes[0], 1]], p: "400013", m: null }).split(".")[0];
const tampered = goodBody + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const badSig = await get("/checkout?token=" + encodeURIComponent(tampered));
check("checkout bad signature 400", badSig.status === 400, String(badSig.status));
check("checkout bad signature friendly", badSig.body.includes("could not read this checkout link"));

const expired = mintCheckoutToken({ cid: "c1", l: [[p0.id, p0.inStockSizes[0], 1]], p: null, m: null }, undefined, -10);
const exp = await get("/checkout?token=" + encodeURIComponent(expired));
check("checkout expired 410", exp.status === 410, String(exp.status));
check("checkout expired copy", exp.body.includes("has expired"));

// --- a real member cart -----------------------------------------------------
const a = catalog.products.find((p) => p.inStock && p.price > 900)!;
const b = catalog.products.find((p) => p.inStock && p.id !== a.id && p.price > 900)!;
const lines: [string, string, number][] = [
  [a.id, a.inStockSizes[0], 2],
  [b.id, b.inStockSizes[0], 1],
];
const token = mintCheckoutToken({ cid: "cart-smoke", l: lines, p: "400013", m: "gold-demo" });
const expectedPayload = verifyCheckoutToken(token);
check("token round trip", expectedPayload.m === "gold-demo" && expectedPayload.l.length === 2);

const priced = priceCart(lines.map(([productId, size, quantity]) => ({ productId, size, quantity })), "gold-demo");
check(
  "statement balances",
  priced.listSubtotal - priced.memberDiscount + priced.deliveryFee === priced.total,
  JSON.stringify({ l: priced.listSubtotal, d: priced.memberDiscount, f: priced.deliveryFee, t: priced.total })
);
const expectedDiscount =
  priced.lines.reduce((n, l) => n + (l.unitList - Math.round(l.unitList * 0.9)) * l.quantity, 0);
check("gold discount is 10pc per unit", priced.memberDiscount === expectedDiscount,
  priced.memberDiscount + " vs " + expectedDiscount);

const co = await get("/checkout?token=" + encodeURIComponent(token));
check("checkout 200", co.status === 200, String(co.status));
check("checkout shows tier", co.body.includes("Gold member"));
check("checkout prefills pincode", co.body.includes('value="400013"'));
check("checkout subtotal is pre-discount", co.body.includes(formatRupees(priced.listSubtotal)));
check("checkout discount row", co.body.includes("- " + formatRupees(priced.memberDiscount)));
check("checkout total", co.body.includes(formatRupees(priced.total)));
check("checkout has address fields", co.body.includes('name="fullName"') && co.body.includes('name="pincode"'));
check("checkout has line thumbnails", co.body.includes(a.thumbnailUrl));

// statement adds up as rendered: pull the rupee figures out of the summary rows
const rows = [...co.body.matchAll(/<span>(?:- )?Rs ([\d,]+)<\/span>/g)].map((m) => Number(m[1].replace(/,/g, "")));
check("rendered rows found", rows.length >= 3, JSON.stringify(rows));

/** Sum the visible per-line figures (the last rupee value in each cost cell). */
function renderedLineSum(html: string): number {
  return [...html.matchAll(/<div class="sitem-cost">([\s\S]*?)<\/div>/g)]
    .map((m) => [...m[1].matchAll(/Rs ([\d,]+)/g)].pop())
    .reduce((n, m) => n + (m ? Number(m[1].replace(/,/g, "")) : 0), 0);
}
check("checkout lines sum to the subtotal shown", renderedLineSum(co.body) === priced.listSubtotal,
  renderedLineSum(co.body) + " vs " + priced.listSubtotal);

// --- payment ----------------------------------------------------------------
const badAddr = await post("/payment", { token, fullName: "", address: "x", city: "", pincode: "12" });
check("payment rejects bad address 422", badAddr.status === 422, String(badAddr.status));
check("payment shows field errors", badAddr.body.includes("six digit pincode"));
check("payment keeps typed values", badAddr.body.includes('value="12"'));

const addr = { token, fullName: "Demo Shopper", address: "1 Example Road", city: "Mumbai", pincode: "400013" };
const pay = await post("/payment", addr);
check("payment 200", pay.status === 200, String(pay.status));
check("payment shows amount", pay.body.includes("Pay " + formatRupees(priced.total)));
check("payment has spinner", pay.body.includes("paySpinner") && pay.body.includes("1500"));
check("payment labelled demo", pay.body.toLowerCase().includes("no real payment"));

// HARD CONSTRAINT: no payment instrument anywhere in the rendered flow
const allHtml = home.body + pdp.body + co.body + pay.body;
const controls = [...allHtml.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map((m) => m[0]);
const bannedControl = /(card|cvv|cvc|expiry|upi|vpa|netbank|iban|account|ifsc|payment)/i;
check(
  "no payment instrument form control",
  !controls.some((c) => bannedControl.test(c)),
  controls.filter((c) => bannedControl.test(c)).join(" | ").slice(0, 300)
);
const coNames = [...co.body.matchAll(/<(?:input|textarea)\b[^>]*name="([^"]+)"/g)]
  .map((m) => m[1])
  .sort()
  .join(",");
check("checkout collects only address fields plus the token",
  coNames === "address,city,fullName,pincode,token", coNames);
const inputs = [...pay.body.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
check("payment page inputs are hidden only", inputs.every((i) => i.includes('type="hidden"')), inputs.join(" | ").slice(0, 300));

// --- confirm + order --------------------------------------------------------
const confirm = await post("/payment/confirm", addr);
check("confirm 303", confirm.status === 303, String(confirm.status));
check("confirm redirects to order", !!confirm.loc && confirm.loc.startsWith("/order/FC-"), String(confirm.loc));

const order = await get(confirm.loc!);
check("order 200", order.status === 200, String(order.status));
check("order shows number", order.body.includes(confirm.loc!.replace("/order/", "")));
check("order shows total", order.body.includes(formatRupees(priced.total)));
check("order shows address", order.body.includes("1 Example Road"));
check("order shows eta", /Arriving by/.test(order.body));
check("order shows discount row", order.body.includes("- " + formatRupees(priced.memberDiscount)));
check("order lines sum to the subtotal shown", renderedLineSum(order.body) === priced.listSubtotal,
  renderedLineSum(order.body) + " vs " + priced.listSubtotal);

check("unknown order 404", (await get("/order/FC-NOPE99")).status === 404);
check("get payment 405", (await get("/payment")).status === 405);
check("unknown path 404", (await get("/nope")).status === 404);

// --- house style ------------------------------------------------------------
const corpus = home.body + cat.body + pdp.body + missing.body + co.body + pay.body + order.body + exp.body + badSig.body;
// Matched by code point rather than by literal glyph, so this file stays clean under a naive
// grep for the very characters it is policing. U+2012 to U+2015 covers figure, en, em and bar.
const dashes = [...corpus].filter((ch) => {
  const cp = ch.codePointAt(0)!;
  return cp >= 0x2012 && cp <= 0x2015;
});
check("no em or en dashes", dashes.length === 0, dashes.length + " found: " + [...new Set(dashes)].join(""));
check("uses Rs prefix", !corpus.includes("₹"));

server.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
