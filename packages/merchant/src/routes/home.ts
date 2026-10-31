/**
 * Landing page, and the same page filtered by category.
 *
 * The category view is a query parameter on this route rather than a route of its own, so every
 * link in the header nav resolves to something real. A storefront with dead nav links reads as
 * a mock in the first three seconds, which is the opposite of what this page is for.
 *
 * Selection is deterministic (rating, then id) so a rehearsal and the live run show the same
 * products in the same order.
 */

import { Router } from "express";

import { catalog, type Product } from "../catalog.js";
import { FREE_DELIVERY_THRESHOLD, formatRupees } from "../pricing.js";
import {
  categoryLabel,
  escapeHtml,
  icon,
  image,
  claudeBand,
  productCard,
  renderPage,
} from "../layout.js";

const FEATURED_COUNT = 8;
const CATEGORY_COUNT = 24;

function shoppable(): Product[] {
  // Member only styles are hidden to a signed out visitor, which is what this page is.
  return catalog.products.filter((p) => p.inStock && !p.memberOnly);
}

function byRating(a: Product, b: Product): number {
  return b.rating - a.rating || a.id.localeCompare(b.id);
}

/** There is no all-products page, so every "shop more" link names the category it opens. A link
 *  labelled "see everything" that shows one category is a small lie the eye catches. */
function firstCategory(): string {
  return catalog.categories[0] ?? "shirts";
}

function heroFigure(product: Product): string {
  const src = product.galleryUrls[0] ?? product.thumbnailUrl;
  return `<figure>${image({
    src,
    alt: product.name + " by " + product.brand,
    eager: true,
    fallbackWidth: 420,
    fallbackHeight: 560,
  })}</figure>`;
}

/**
 * The primary action names the section it scrolls to. It used to read "Shop the edit", which
 * broke the naming rule above it three ways: it promised the whole collection and delivered a
 * jump to eight best rated styles, it only echoed the eyebrow, and "edit" is fashion-press
 * vocabulary rather than anything a shopper here says.
 *
 * Kept as a JS comment rather than an HTML one. Notes inside the template string ship to the
 * browser and show up in view-source, which is not where reasoning about copy belongs.
 */
function hero(): string {
  const art = shoppable().slice().sort(byRating).slice(0, 2).map(heroFigure).join("");

  return `<section class="hero"><div class="wrap"><div class="hero-inner">
  <div>
    <p class="eyebrow">Autumn edit</p>
    <h1>Clothes that hold their shape past the tenth wash.</h1>
    <p>Small runs, mills we can name, and honest pricing. ${catalog.products.length} styles in
    cotton, linen and handloom blends, cut for the way the weather actually behaves here.</p>
    <div class="hero-actions">
      <a class="btn btn--primary btn--lg" href="#featured">See the best rated</a>
      <a class="btn btn--ghost btn--lg" href="/?category=${encodeURIComponent(firstCategory())}">Browse ${escapeHtml(categoryLabel(firstCategory()))}</a>
    </div>
  </div>
  <div class="hero-art">${art}</div>
</div></div></section>`;
}

function facts(): string {
  return `<div class="wrap"><div class="hero-strip">
  <span>${icon("truck")} <b>Free delivery</b> over ${escapeHtml(formatRupees(FREE_DELIVERY_THRESHOLD))}</span>
  <span>${icon("returns")} <b>30 day</b> returns, collected from you</span>
  <span>${icon("spark")} <b>Member prices</b> on every style</span>
</div></div>`;
}

/**
 * The one place this storefront says out loud what it is for. Worth keeping on the landing
 * page: it sets up the handoff before anyone clicks through to a product.
 */
/**
 * Replaced an explanatory note aimed at someone who had ALREADY arrived from an assistant.
 * That reader is the rarer one and was already reassured by the checkout itself; the common
 * visitor has never heard of any of this. The band keeps the same reassurance, that payment
 * happens here, and adds the thing the note was missing: a way to actually get it.
 */
function assistantCta(): string {
  return `<div class="wrap">${claudeBand()}</div>`;
}

export function createHomeRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    // Express 5 can hand back an array when a parameter repeats, so narrow to a string.
    const raw = typeof req.query.category === "string" ? req.query.category.toLowerCase() : null;
    const category = raw && catalog.categories.includes(raw) ? raw : null;

    if (category) {
      const products = catalog.products
        .filter((p) => p.category === category && !p.memberOnly)
        .sort((a, b) => b.discountPct - a.discountPct || a.id.localeCompare(b.id))
        .slice(0, CATEGORY_COUNT);

      return res.send(
        renderPage({
          title: categoryLabel(category),
          description: `${categoryLabel(category)} at FashionCart.`,
          activeCategory: category,
          body: `${facts()}
<section class="section"><div class="wrap">
  <div class="section-head">
    <div>
      <p class="eyebrow">${escapeHtml(products.length)} styles</p>
      <h2>${escapeHtml(categoryLabel(category))}</h2>
    </div>
    <a class="link" href="/">Back to the edit</a>
  </div>
  <div class="grid">${products.map(productCard).join("")}</div>
</div></section>
${assistantCta()}`,
        })
      );
    }

    const featured = shoppable().slice().sort(byRating).slice(0, FEATURED_COUNT);

    res.send(
      renderPage({
        title: "Everyday clothing, made in small runs",
        body: `${hero()}
${facts()}
<section class="section" id="featured"><div class="wrap">
  <div class="section-head">
    <div>
      <p class="eyebrow">Best rated this month</p>
      <h2>Featured styles</h2>
    </div>
    <a class="link" href="/?category=${encodeURIComponent(firstCategory())}">Shop ${escapeHtml(categoryLabel(firstCategory()).toLowerCase())}</a>
  </div>
  <div class="grid">${featured.map(productCard).join("")}</div>
</div></section>
${assistantCta()}`,
      })
    );
  });

  return router;
}
