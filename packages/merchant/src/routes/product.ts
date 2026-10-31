/**
 * Product detail.
 *
 * There is no add to bag button, and that is deliberate rather than unfinished. The bag lives
 * in the assistant conversation; this site's job starts at the signed handoff. A button that
 * did nothing would undercut the demo, so the space where a retailer puts the primary action
 * carries the handoff explanation instead. Adding a real bag later is a route and a session
 * store, not a redesign.
 *
 * Size buttons are rendered from stockBySize, with sold out sizes disabled rather than hidden:
 * a shopper needs to see that their size exists and is gone, not wonder whether it is made.
 */

import { Router } from "express";

import { catalog, findProduct, type Product } from "../catalog.js";
import { FREE_DELIVERY_THRESHOLD, formatRupees } from "../pricing.js";
import {
  categoryLabel,
  escapeHtml,
  icon,
  image,
  productCard,
  renderPage,
  stars,
} from "../layout.js";

function gallery(product: Product): string {
  const urls = product.galleryUrls.length > 0 ? product.galleryUrls : [product.thumbnailUrl];
  const main = urls[0];

  const thumbs = urls
    .map((url, i) => {
      const active = i === 0 ? " is-active" : "";
      return `<button type="button" class="thumb${active}" data-full="${escapeHtml(url)}"
      aria-label="View image ${i + 1} of ${urls.length}"${i === 0 ? ' aria-current="true"' : ""}>
      ${image({ src: url, alt: "", fallbackWidth: 140, fallbackHeight: 187 })}</button>`;
    })
    .join("");

  return `<div>
  <img id="galleryMain" class="gallery-main" src="${escapeHtml(main)}"
    alt="${escapeHtml(product.name)}" decoding="async"
    data-fw="600" data-fh="800" onerror="fcImgFallback(this)">
  ${urls.length > 1 ? `<div class="gallery-thumbs">${thumbs}</div>` : ""}
</div>`;
}

function sizeButtons(product: Product): string {
  const buttons = product.sizes
    .map((size) => {
      const stock = product.stockBySize[size] ?? 0;
      if (stock === 0) {
        return `<button type="button" class="size" disabled aria-disabled="true"
        title="Sold out in ${escapeHtml(size)}">${escapeHtml(size)}</button>`;
      }
      const low = stock <= 3 ? ` title="Only ${stock} left"` : "";
      return `<button type="button" class="size"${low}>${escapeHtml(size)}</button>`;
    })
    .join("");

  const soldOut = product.sizes.length - product.inStockSizes.length;
  const note =
    soldOut > 0
      ? `<p class="size-note">${soldOut} size${soldOut === 1 ? "" : "s"} sold out. Crossed out sizes are not available.</p>`
      : "";

  return `<div class="opt">
  <p class="opt-label">Size</p>
  <div class="sizes">${buttons}</div>
  ${note}
</div>`;
}

function colourRow(product: Product): string {
  const swatches = product.colours
    .map(
      (c) =>
        `<span class="colour"><i style="background:${escapeHtml(c.hex)}"></i>${escapeHtml(c.name)}</span>`
    )
    .join("");

  return `<div class="opt">
  <p class="opt-label">Colour</p>
  <div class="colour-row">${swatches}</div>
</div>`;
}

function attributes(product: Product): string {
  const rows: [string, string][] = [
    ["Fabric", product.attributes.fabric],
    ["Care", product.attributes.care],
    ["Fit", product.attributes.fit],
    ["Occasion", product.attributes.occasion],
    ["Pattern", product.attributes.pattern],
    ["Style code", product.id],
  ];

  return `<div class="attrs">
  <p class="opt-label">Details</p>
  <dl class="attr-grid">
    ${rows
      .filter(([, value]) => Boolean(value))
      .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("")}
  </dl>
</div>`;
}

function creditLine(product: Product): string {
  const { author, source, licence, url } = product.credit;
  // Generated placeholders are not photographs and have no photographer.
  if (source === "generated") {
    const lic = licence ? ` (${escapeHtml(licence)})` : "";
    return `<p class="credit">Placeholder image generated for this demo${lic}.</p>`;
  }
  // Source names arrive from the feed lower cased ("pexels"). Presented as a proper noun here
  // because it is one, and a credit line is exactly where getting that wrong looks careless.
  const where = source ? " on " + escapeHtml(source.charAt(0).toUpperCase() + source.slice(1)) : "";
  const lic = licence ? ", " + escapeHtml(licence) : "";
  const body = `Photograph by ${escapeHtml(author)}${where}${lic}.`;
  return `<p class="credit">${url ? `<a href="${escapeHtml(url)}" rel="noreferrer nofollow">${body}</a>` : body}</p>`;
}

/**
 * The feed's longDescription opens by repeating shortDescription verbatim, so printing both
 * gives the shopper the same sentence twice. Trim the repeat rather than dropping either field:
 * the short line earns its place as the lead, and the rest of the long copy is what a shopper
 * scrolls for.
 */
function extendedCopy(product: Product): string {
  const long = product.longDescription.trim();
  const short = product.shortDescription.trim();
  if (!long.startsWith(short)) return long;
  return long.slice(short.length).trim();
}

export function createProductRouter(): Router {
  const router = Router();

  router.get("/product/:id", (req, res) => {
    const product = findProduct(req.params.id);

    if (!product) {
      const suggestions = catalog.products
        .filter((p) => p.inStock && !p.memberOnly)
        .slice()
        .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
        .slice(0, 4);

      return res.status(404).send(
        renderPage({
          title: "Style not found",
          body: `<div class="wrap"><div class="message">
  <p class="eyebrow">404</p>
  <h1>We cannot find that style</h1>
  <p>The style code <b>${escapeHtml(req.params.id)}</b> is not in our catalogue. It may have been
  retired, or the link may have picked up a stray character.</p>
  <div class="message-actions"><a class="btn btn--primary" href="/">Back to the storefront</a></div>
</div></div>
<section class="section"><div class="wrap">
  <div class="section-head"><h2>Popular right now</h2></div>
  <div class="grid">${suggestions.map(productCard).join("")}</div>
</div></section>`,
        })
      );
    }

    const discount =
      product.discountPct > 0
        ? `<span class="mrp">${escapeHtml(formatRupees(product.mrp))}</span>` +
          `<span class="off">${product.discountPct}% off</span>`
        : "";

    const stockLine = product.inStock
      ? product.totalStock <= 8
        ? `<p class="size-note">Low stock: ${product.totalStock} pieces left across all sizes.</p>`
        : ""
      : '<p class="size-note">This style is sold out in every size.</p>';

    res.send(
      renderPage({
        title: product.name,
        description: product.shortDescription,
        activeCategory: product.category,
        body: `<div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/">Home</a> / <a href="/?category=${encodeURIComponent(product.category)}">${escapeHtml(categoryLabel(product.category))}</a> / ${escapeHtml(product.name)}
  </nav>
  <div class="pdp">
    ${gallery(product)}
    <div class="pdp-info">
      <p class="pdp-brand">${escapeHtml(product.brand)}</p>
      <h1>${escapeHtml(product.name)}</h1>
      ${stars(product.rating, product.reviewCount)}
      <div class="pdp-price">
        <span class="price">${escapeHtml(formatRupees(product.price))}</span>
        ${discount}
      </div>
      <p class="pdp-tax">Inclusive of all taxes. Free delivery over ${escapeHtml(formatRupees(FREE_DELIVERY_THRESHOLD))}.</p>
      <p>${escapeHtml(product.shortDescription)}</p>
      ${colourRow(product)}
      ${sizeButtons(product)}
      ${stockLine}
      <div class="handoff">
        <h3>Ready to buy?</h3>
        <p>Ask your assistant to add this style to your bag. It hands over a secure checkout link
        that opens on FashionCart, where delivery details and payment stay with us.</p>
      </div>
      ${extendedCopy(product) ? `<p class="muted small">${escapeHtml(extendedCopy(product))}</p>` : ""}
      ${attributes(product)}
      <div class="assure" style="margin-top:1.4rem">${icon("returns")}
        <span>30 day returns, collected from your address. Exchanges are free.</span></div>
      ${creditLine(product)}
    </div>
  </div>
</div>`,
      })
    );
  });

  return router;
}
