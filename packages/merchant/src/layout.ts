/**
 * Page shell, design tokens and the handful of components every page shares.
 *
 * Server rendered strings, no view engine and no client framework. The only JavaScript that
 * reaches the browser is the two small functions at the bottom of this file: an image fallback
 * and the product gallery swap. Everything else is HTML and CSS, which is also why the pages
 * survive a flaky conference network.
 *
 * House style, enforced by eye and by the check in the README: no em dashes and no en dashes in
 * anything a shopper can read.
 */

import { catalog, type Product } from "./catalog.js";
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD, formatCount, formatRupees } from "./pricing.js";

export const SITE_NAME = "FashionCart";

/** Category slugs come from the feed in lower case. These are the shopper facing labels. */
const CATEGORY_LABELS: Record<string, string> = {
  shirts: "Shirts",
  trousers: "Trousers",
  kurtas: "Kurtas",
  dresses: "Dresses",
  footwear: "Footwear",
  accessories: "Accessories",
};

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLES = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none !important}

:root{
  --ink:#16181A;
  --ink-2:#4A4F53;
  --ink-3:#7C8287;
  --indigo:#0F5C4A;
  --indigo-700:#0A3F33;
  --indigo-50:#E3EEE9;
  --sand:#F6F5F1;
  --sand-2:#ECEAE4;
  --ivory:#FBFAF7;
  --surface:#FFFFFF;
  --line:#E2DFD8;
  --line-2:#CFCBC2;
  --marigold:#C98A2E;
  --marigold-50:#F7EEDD;
  --success:#1B6A4E;
  --success-50:#E9F3EE;
  --danger:#8E3320;
  --danger-50:#FBEDE9;
  --r-lg:14px;
  --r:10px;
  --r-sm:6px;
  --shadow-1:0 1px 2px rgba(25,23,32,.05);
  --shadow-2:0 2px 6px rgba(25,23,32,.06),0 14px 30px rgba(25,23,32,.07);
  --maxw:1160px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
}

html{-webkit-text-size-adjust:100%}
body{
  margin:0;
  font-family:var(--font);
  font-size:16px;
  line-height:1.62;
  color:var(--ink);
  background:var(--ivory);
  -webkit-font-smoothing:antialiased;
}
img{display:block;max-width:100%}
/* Inline icons carry no width or height attribute, and an SVG without one falls back to the
   replaced-element default of 300x150. Sizing them from the text they sit beside keeps every
   icon in proportion; the few that need to be larger override this below. */
svg{width:1.15em;height:1.15em;flex:none;vertical-align:-.18em}
a{color:var(--indigo);text-underline-offset:3px}
h1,h2,h3,h4{margin:0 0 .55rem;line-height:1.18;letter-spacing:-.015em;font-weight:650}
h1{font-size:clamp(1.7rem,3.2vw,2.25rem)}
h2{font-size:1.32rem}
h3{font-size:1.02rem}
p{margin:0 0 1rem}
ul{margin:0;padding:0;list-style:none}
:focus-visible{outline:2px solid var(--indigo);outline-offset:2px;border-radius:3px}

.wrap{max-width:var(--maxw);margin:0 auto;padding:0 1.25rem}
.wrap--narrow{max-width:880px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.eyebrow{
  font-size:.7rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:var(--marigold);margin:0 0 .5rem;
}
.muted{color:var(--ink-2)}
.small{font-size:.85rem}
.tiny{font-size:.78rem}

/* ---------- header ---------- */
.announce{
  background:var(--indigo-700);color:#EFEAF7;font-size:.76rem;letter-spacing:.09em;
  text-transform:uppercase;text-align:center;padding:.5rem 1rem;
}
.announce span{opacity:.65;padding:0 .55rem}
.site-header{
  position:sticky;top:0;z-index:20;background:rgba(253,251,247,.94);
  backdrop-filter:saturate(140%) blur(8px);border-bottom:1px solid var(--line);
}
.header-bar{display:flex;align-items:center;gap:2rem;min-height:66px}
.brand{
  display:inline-flex;align-items:baseline;text-decoration:none;font-weight:700;
  font-size:1.4rem;letter-spacing:-.028em;color:var(--ink);
}
.brand-c{color:var(--indigo)}
.brand-dot{
  width:5px;height:5px;border-radius:50%;background:var(--marigold);
  align-self:flex-end;margin:0 0 .42rem .22rem;
}
.nav{display:flex;gap:1.6rem;margin-left:auto}
.nav a{
  text-decoration:none;color:var(--ink-2);font-size:.82rem;font-weight:600;
  letter-spacing:.07em;text-transform:uppercase;padding:.35rem 0;
  border-bottom:2px solid transparent;
}
.nav a:hover{color:var(--ink);border-bottom-color:var(--marigold)}
.nav a.is-active{color:var(--indigo);border-bottom-color:var(--indigo)}
.header-note{
  margin-left:auto;display:inline-flex;align-items:center;gap:.45rem;
  color:var(--ink-2);font-size:.82rem;font-weight:600;letter-spacing:.03em;
}
.header-note svg{width:15px;height:15px}

/* ---------- hero ---------- */
.hero{background:var(--sand);border-bottom:1px solid var(--line)}
.hero-inner{
  display:grid;grid-template-columns:1.05fr .95fr;gap:3rem;align-items:center;
  padding:3.6rem 0 3.4rem;
}
.hero h1{font-size:clamp(2rem,4.4vw,3.1rem);letter-spacing:-.03em;line-height:1.04;margin-bottom:1rem}
.hero p{max-width:44ch;color:var(--ink-2);font-size:1.06rem}
.hero-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.6rem}
.hero-art{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.hero-art figure{margin:0}
.hero-art figure:nth-child(2){margin-top:2.6rem}
.hero-art img{
  width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--sand-2);
}
.hero-strip{
  display:flex;flex-wrap:wrap;gap:.6rem 2rem;padding:1.1rem 0 1.3rem;
  color:var(--ink-2);font-size:.86rem;
}
.hero-strip span{display:inline-flex;align-items:center;gap:.5rem}
.hero-strip svg{color:var(--indigo)}
.hero-strip b{color:var(--ink);font-weight:650}

/* ---------- sections ---------- */
.section{padding:3rem 0}
.section--tight{padding:2rem 0}
.section-head{
  display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;
  margin-bottom:1.6rem;
}
.section-head h2{margin:0}
.section-head .link{font-size:.85rem;font-weight:600;text-decoration:none;color:var(--indigo)}
.section-head .link:hover{text-decoration:underline}

/* ---------- product grid ---------- */
.grid{display:grid;gap:1.6rem 1.35rem;grid-template-columns:repeat(auto-fill,minmax(238px,1fr))}
.card{
  display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r);overflow:hidden;text-decoration:none;color:inherit;
  transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease;
}
.card:hover{border-color:var(--line-2);transform:translateY(-2px);box-shadow:var(--shadow-2)}
.card-media{position:relative;background:var(--sand-2)}
.card-media img{width:100%;aspect-ratio:3/4;object-fit:cover}
.card-body{padding:.85rem .95rem 1rem;display:flex;flex-direction:column;gap:.3rem;flex:1}
.card-brand{
  margin:0;font-size:.7rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);
}
.card-name{
  margin:0;font-size:.97rem;font-weight:600;letter-spacing:-.01em;line-height:1.35;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.card-foot{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-top:auto;padding-top:.55rem}

.price-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin-top:.2rem}
.price{font-size:1.05rem;font-weight:700;letter-spacing:-.01em}
.mrp{color:var(--ink-3);text-decoration:line-through;font-size:.86rem}
.off{color:var(--success);font-size:.82rem;font-weight:650}

.tag{
  position:absolute;top:.6rem;left:.6rem;font-size:.66rem;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;padding:.28rem .5rem;border-radius:var(--r-sm);background:var(--ink);
  color:#fff;
}
.tag--member{background:var(--marigold);color:#3A2703}
.tag--out{background:rgba(25,23,32,.78)}

.stars{display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--ink-2);white-space:nowrap}
.stars .glyphs{color:var(--marigold);letter-spacing:.06em}
.swatches{display:inline-flex;gap:.28rem}
.swatch{
  width:14px;height:14px;border-radius:50%;border:1px solid rgba(25,23,32,.22);
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.55);
}

/* ---------- buttons ---------- */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  font:inherit;font-weight:650;letter-spacing:.01em;line-height:1;
  padding:.82rem 1.35rem;border-radius:var(--r-sm);border:1px solid transparent;
  text-decoration:none;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease;
}
.btn--primary{background:var(--indigo);color:#fff}
.btn--primary:hover{background:var(--indigo-700)}
.btn--ghost{background:transparent;color:var(--ink);border-color:var(--line-2)}
.btn--ghost:hover{border-color:var(--ink-3);background:var(--sand)}
.btn--lg{padding:1rem 1.6rem;font-size:1.02rem}
.btn--block{width:100%}
.btn:disabled{opacity:.55;cursor:not-allowed}

/* ---------- product detail ---------- */
.crumbs{font-size:.82rem;color:var(--ink-3);padding:1.4rem 0 .2rem}
.crumbs a{color:var(--ink-2);text-decoration:none}
.crumbs a:hover{text-decoration:underline}
.pdp{display:grid;grid-template-columns:1.02fr .98fr;gap:3rem;padding:1.4rem 0 3rem;align-items:start}
.gallery-main{
  width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:var(--r-lg);
  border:1px solid var(--line);background:var(--sand-2);
}
.gallery-thumbs{display:flex;gap:.6rem;margin-top:.75rem;flex-wrap:wrap}
.thumb{
  padding:0;border:1px solid var(--line);background:var(--sand-2);border-radius:var(--r-sm);
  overflow:hidden;cursor:pointer;width:66px;
}
.thumb img{width:100%;aspect-ratio:3/4;object-fit:cover}
.thumb.is-active{border-color:var(--indigo);box-shadow:0 0 0 1px var(--indigo)}
.pdp-brand{
  font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);
  margin:0 0 .35rem;
}
.pdp h1{font-size:clamp(1.45rem,2.4vw,1.95rem);margin-bottom:.55rem}
.pdp-price{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap;margin:.9rem 0 .2rem}
.pdp-price .price{font-size:1.65rem}
.pdp-price .mrp{font-size:1rem}
.pdp-price .off{font-size:.95rem}
.pdp-tax{font-size:.8rem;color:var(--ink-3);margin:0 0 1.4rem}
.opt{margin:1.35rem 0}
.opt-label{
  font-size:.74rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
  color:var(--ink-2);margin:0 0 .6rem;
}
.colour-row{display:flex;gap:.85rem;flex-wrap:wrap}
.colour{display:inline-flex;align-items:center;gap:.45rem;font-size:.88rem;color:var(--ink-2)}
.colour i{
  width:22px;height:22px;border-radius:50%;display:inline-block;
  border:1px solid rgba(25,23,32,.2);box-shadow:inset 0 0 0 2px rgba(255,255,255,.5);
}
.sizes{display:flex;gap:.5rem;flex-wrap:wrap}
.size{
  min-width:56px;padding:.6rem .7rem;text-align:center;font:inherit;font-size:.9rem;font-weight:600;
  background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r-sm);cursor:pointer;
}
.size:hover:not(:disabled){border-color:var(--indigo);color:var(--indigo)}
.size:disabled{
  color:var(--ink-3);border-color:var(--line);cursor:not-allowed;background:var(--sand);
  text-decoration:line-through;
}
.size-note{font-size:.8rem;color:var(--ink-3);margin:.55rem 0 0}
.handoff{
  margin:1.6rem 0 1.2rem;padding:1.1rem 1.2rem;border:1px solid var(--line-2);
  border-radius:var(--r);background:var(--sand);
}
.handoff h3{margin:0 0 .3rem;font-size:.98rem}
.handoff p{margin:0;font-size:.9rem;color:var(--ink-2)}
.attrs{border-top:1px solid var(--line);margin-top:1.6rem;padding-top:1.2rem}
.attr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem 1.5rem;margin:0}
.attr-grid dt{font-size:.72rem;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3)}
.attr-grid dd{margin:.1rem 0 0;font-size:.93rem}
.credit{font-size:.78rem;color:var(--ink-3);margin-top:1.6rem}
.credit a{color:var(--ink-3)}

/* ---------- checkout ---------- */
.steps{
  display:flex;gap:.6rem;align-items:center;font-size:.78rem;font-weight:650;
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:0 0 1.4rem;
}
.steps .is-done{color:var(--ink-2)}
.steps .is-now{color:var(--indigo)}
.checkout-grid{
  display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:2.6rem;
  padding:2rem 0 3.5rem;align-items:start;
}
.panel{
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:1.5rem 1.6rem;box-shadow:var(--shadow-1);
}
.panel + .panel{margin-top:1.2rem}
.panel--quiet{background:var(--sand);box-shadow:none}
.panel-title{
  font-size:.78rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
  color:var(--ink-2);margin:0 0 1.1rem;
}
.co-side{position:sticky;top:5.6rem}

.field{margin-bottom:1.1rem}
.field label{display:block;font-size:.82rem;font-weight:650;margin-bottom:.35rem;color:var(--ink-2)}
.field input,.field textarea{
  width:100%;font:inherit;font-size:.97rem;color:var(--ink);background:var(--surface);
  border:1px solid var(--line-2);border-radius:var(--r-sm);padding:.7rem .8rem;
}
.field input:focus,.field textarea:focus{border-color:var(--indigo);outline:none;box-shadow:0 0 0 3px var(--indigo-50)}
.field textarea{resize:vertical;min-height:84px;line-height:1.5}
.field.has-error input,.field.has-error textarea{border-color:var(--danger);background:var(--danger-50)}
.field-error{color:var(--danger);font-size:.8rem;margin:.35rem 0 0}
.field-row{display:grid;grid-template-columns:1fr 200px;gap:1rem}
.form-foot{margin-top:1.5rem;display:flex;flex-direction:column;gap:.8rem}

.sitems{border-bottom:1px solid var(--line);padding-bottom:.3rem;margin-bottom:1rem}
.sitem{display:grid;grid-template-columns:56px 1fr auto;gap:.85rem;padding:.7rem 0;align-items:start}
.sitem + .sitem{border-top:1px solid var(--line)}
.sitem img{width:56px;aspect-ratio:3/4;object-fit:cover;border-radius:var(--r-sm);background:var(--sand-2)}
.sitem-name{font-size:.92rem;font-weight:600;line-height:1.35;margin:0}
.sitem-meta{font-size:.8rem;color:var(--ink-3);margin:.15rem 0 0}
.sitem-cost{text-align:right;font-size:.93rem;font-weight:650;white-space:nowrap}
.sitem-cost s{display:block;font-weight:400;color:var(--ink-3);font-size:.8rem}

.statement{margin:0}
.srow{display:flex;justify-content:space-between;gap:1rem;padding:.34rem 0;font-size:.93rem;color:var(--ink-2)}
.srow span:last-child{color:var(--ink);font-variant-numeric:tabular-nums}
.srow--credit span:last-child{color:var(--success);font-weight:600}
.srow--free span:last-child{color:var(--success);font-weight:600}
.srow--total{
  border-top:1px solid var(--line);margin-top:.7rem;padding-top:.85rem;
  font-size:1.12rem;font-weight:700;color:var(--ink);
}
.srow--total span:last-child{font-size:1.22rem}
.saved{
  margin-top:.9rem;background:var(--success-50);color:var(--success);border-radius:var(--r-sm);
  padding:.55rem .7rem;font-size:.84rem;font-weight:600;text-align:center;
}
.pill{
  display:inline-flex;align-items:center;gap:.4rem;font-size:.76rem;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;padding:.3rem .6rem;border-radius:999px;
  background:var(--marigold-50);color:#7A4E06;border:1px solid #EBD3A2;
}
.pill--quiet{background:var(--indigo-50);color:var(--indigo);border-color:#D5DAEE}
.assure{display:flex;gap:.7rem;align-items:flex-start;font-size:.85rem;color:var(--ink-2)}
.assure + .assure{margin-top:.8rem}
.assure svg{width:18px;height:18px;flex:none;margin-top:.15rem;color:var(--indigo)}

.notice{
  border:1px solid var(--line-2);background:var(--sand);border-radius:var(--r);
  padding:.85rem 1rem;font-size:.88rem;color:var(--ink-2);margin:0 0 1.4rem;
}
.notice b{color:var(--ink)}
.notice--warn{background:var(--marigold-50);border-color:#EBD3A2}

/* ---------- payment ---------- */
.pay-wrap{max-width:560px;margin:0 auto;padding:2.6rem 0 4rem}
.pay-card{text-align:center}
.pay-card h1{font-size:2.1rem;margin:.7rem 0 .3rem;letter-spacing:-.03em}
.pay-sub{color:var(--ink-2);font-size:.95rem;margin:0 0 1.5rem}
.pay-lines{text-align:left;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:1rem 0;margin:0 0 1.4rem}
.badge-demo{
  display:inline-flex;align-items:center;gap:.4rem;font-size:.7rem;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:#7A4E06;background:var(--marigold-50);
  border:1px solid #EBD3A2;border-radius:999px;padding:.3rem .7rem;
}
.pay-note{font-size:.82rem;color:var(--ink-3);margin:1.1rem 0 0}
.spinner-wrap{display:flex;flex-direction:column;align-items:center;gap:.9rem;padding:.8rem 0 .2rem}
.spinner{
  width:30px;height:30px;border-radius:50%;border:3px solid var(--line-2);
  border-top-color:var(--indigo);animation:spin .9s linear infinite;
}
.spinner-text{font-size:.9rem;color:var(--ink-2);font-weight:600}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  .spinner{animation-duration:2.4s}
  .card{transition:none}
}

/* ---------- order confirmation ---------- */
.order-head{background:var(--sand);border-bottom:1px solid var(--line);padding:2.8rem 0 2.4rem}
.order-head h1{margin:0 0 .5rem}
.order-num{
  display:inline-flex;align-items:center;gap:.5rem;background:var(--surface);
  border:1px solid var(--line-2);border-radius:var(--r-sm);padding:.5rem .85rem;
  font-weight:700;letter-spacing:.04em;
}
.order-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:2.6rem;padding:2.4rem 0 3.5rem;align-items:start}
.addr{font-style:normal;font-size:.93rem;color:var(--ink-2);line-height:1.55}
.addr b{color:var(--ink);font-weight:650}
.eta{display:flex;gap:.8rem;align-items:flex-start;padding:.9rem 0 0}
.eta svg{width:20px;height:20px;color:var(--indigo);flex:none;margin-top:.2rem}

/* ---------- message pages ---------- */
.message{max-width:620px;margin:0 auto;padding:4rem 0 5rem;text-align:center}
.message h1{margin-bottom:.8rem}
.message p{color:var(--ink-2)}
.message-actions{display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap;margin-top:1.6rem}

/* ---------- footer ---------- */
.trust{border-top:1px solid var(--line);background:var(--sand)}
.trust-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2rem;padding:2.4rem 0}
.trust-item{display:flex;gap:.9rem;align-items:flex-start}
.trust-item svg{width:22px;height:22px;color:var(--indigo);flex:none;margin-top:.2rem}
.trust-item h3{margin:0 0 .15rem;font-size:.95rem}
.trust-item p{margin:0;font-size:.85rem;color:var(--ink-2)}
.site-footer{background:var(--indigo-700);color:#D6E3DD}
.footer-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:2.4rem;padding:2.8rem 0 2rem}
.site-footer .brand{color:#fff}
.site-footer .brand-c{color:var(--marigold)}
.site-footer h4{
  margin:0 0 .7rem;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#A9A4BE;
  font-weight:700;
}
.site-footer li{font-size:.88rem;padding:.16rem 0;color:#C9DAD2}
/* Every other footer item is plain text. The one real link inherited the global
   a{color:var(--indigo)} and rendered indigo on indigo, which is invisible. */
.site-footer li a{color:#fff;font-weight:600;text-decoration:underline}
.site-footer li a:hover{color:var(--marigold)}
.site-footer p{font-size:.88rem;color:#AFC7BC;max-width:38ch}
.made-by{
  text-align:center;font-size:1.02rem;font-weight:600;letter-spacing:.01em;
  color:#fff;padding:1.25rem 0 1.1rem;margin-top:.6rem;
  border-top:1px solid rgba(255,255,255,.14);
}
.made-by .heart{color:var(--marigold);font-size:1.08em;line-height:1;margin:0 .18em;display:inline-block;transform:translateY(.04em)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

.fineprint{
  border-top:1px solid rgba(255,255,255,.12);padding:1.1rem 0 2rem;font-size:.78rem;
  color:#9C97B2;display:flex;flex-wrap:wrap;gap:.6rem 1.4rem;
}

/* ---------- responsive ---------- */
@media (max-width:960px){
  .hero-inner{grid-template-columns:1fr;gap:2rem;padding:2.6rem 0}
  .hero-art{max-width:420px}
  .pdp{grid-template-columns:1fr;gap:2rem}
  .checkout-grid,.order-grid{grid-template-columns:1fr;gap:1.6rem}
  .co-side{position:static}
  .footer-grid{grid-template-columns:1fr 1fr}
}
@media (max-width:640px){
  body{font-size:15.5px}
  .nav{display:none}
  .grid{grid-template-columns:1fr;gap:1.4rem}
  .card-media img{aspect-ratio:4/5}
  .hero-art figure:nth-child(2){display:none}
  .hero-art{grid-template-columns:1fr}
  .field-row{grid-template-columns:1fr}
  .attr-grid{grid-template-columns:1fr}
  .trust-grid{grid-template-columns:1fr;gap:1.4rem;padding:1.8rem 0}
  .footer-grid{grid-template-columns:1fr;gap:1.6rem}
  .panel{padding:1.2rem}
  .announce span{display:none}
}

/* ---- "shop inside Claude" CTA and the /connect page ----------------------
   Built from the existing tokens only. A CTA in a colour the site does not
   otherwise use is the thing that makes a storefront look like it has been
   sold advertising space. */
.claude-band{
  background:var(--indigo);color:#fff;border-radius:var(--r-lg);
  padding:1.7rem 1.9rem;margin:2.6rem 0;
  display:grid;grid-template-columns:1fr auto;gap:1.6rem;align-items:center;
  box-shadow:var(--shadow-2);
}
.claude-band h2{margin:.35rem 0 .4rem;font-size:1.42rem;line-height:1.25;color:#fff}
.claude-band p{margin:0;color:#C9CFE6;max-width:62ch;font-size:.96rem}
.claude-eyebrow{
  display:inline-flex;align-items:center;gap:.42rem;
  font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  color:var(--marigold);
}
.claude-eyebrow svg{width:15px;height:15px}
.claude-cta{
  display:inline-flex;align-items:center;gap:.5rem;white-space:nowrap;
  background:var(--marigold);color:#241A05;font-weight:700;font-size:.95rem;
  padding:.78rem 1.35rem;border-radius:var(--r);text-decoration:none;
  border:1px solid rgba(0,0,0,.08);
}
.claude-cta:hover{filter:brightness(1.05)}
.claude-cta svg{width:17px;height:17px}
.claude-band .band-note{display:block;margin-top:.55rem;font-size:.78rem;color:#9AA3C4}

/* the same offer, quieter, for the order confirmation page */
.claude-mini{
  border:1px solid var(--line);border-left:3px solid var(--indigo);
  background:var(--indigo-50);border-radius:var(--r);padding:1.05rem 1.2rem;margin-top:1rem;
}
.claude-mini b{display:block;margin-bottom:.2rem}
.claude-mini p{margin:0;font-size:.86rem;color:var(--ink-2)}
.claude-mini a{display:inline-block;margin-top:.6rem;font-weight:600;color:var(--indigo)}

.connect{padding:2.4rem 1.25rem 3.4rem;max-width:1040px}
.connect-head{max-width:44rem;margin-bottom:2.2rem}
.connect-head h1{font-size:2.05rem;line-height:1.16;margin:.7rem 0 .7rem}
.connect-head .lede{font-size:1.05rem;color:var(--ink-2);margin:0}
.pill-live{
  display:inline-flex;align-items:center;gap:.4rem;
  background:var(--success-50);color:var(--success);
  font-size:.74rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  padding:.34rem .7rem;border-radius:999px;
}
.pill-live svg{width:14px;height:14px}
.connect-grid{display:grid;grid-template-columns:1.35fr .85fr;gap:2rem;align-items:start}
.sec-title{font-size:.8rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);margin:0 0 1rem}
/* .howto, NOT .steps: .steps is already the checkout progress indicator further up
   this sheet, and reusing the name laid these out horizontally in uppercase. */
.howto{list-style:none;counter-reset:s;margin:0;padding:0}
.howto li{counter-increment:s;position:relative;padding:0 0 1.35rem 3.1rem}
.howto li::before{
  content:counter(s);position:absolute;left:0;top:-.1rem;
  width:2.1rem;height:2.1rem;border-radius:50%;
  background:var(--indigo);color:#fff;font-weight:700;font-size:.9rem;
  display:flex;align-items:center;justify-content:center;
}
.howto li:not(:last-child)::after{
  content:"";position:absolute;left:1.05rem;top:2.35rem;bottom:.3rem;
  width:1px;background:var(--line-2);
}
.howto b{display:block;margin-bottom:.15rem}
.howto p{margin:0;color:var(--ink-2);font-size:.92rem}
.urlbox{background:var(--sand);border:1px solid var(--line);border-radius:var(--r);
  padding:1rem 1.15rem;margin-top:.4rem}
.urlbox-label{display:block;font-size:.72rem;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:.45rem}
.urlbox code{display:block;font-size:.9rem;word-break:break-all;color:var(--indigo-700);
  font-weight:600}
.connect-side{display:grid;gap:1rem}
.asks{list-style:none;margin:0;padding:0;display:grid;gap:.42rem}
.asks li{background:var(--sand);border:1px solid var(--line);border-radius:999px;
  padding:.4rem .85rem;font-size:.88rem;color:var(--ink-2)}
.soon{border:1px dashed var(--line-2);border-radius:var(--r);padding:1rem 1.15rem;
  background:var(--ivory)}
.soon-tag{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3);border:1px solid var(--line-2);
  border-radius:999px;padding:.16rem .55rem;margin-bottom:.55rem}
.soon p{margin:0 0 .3rem}
.faq{margin-top:2.8rem}
.faq-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem 2rem}
.faq-item b{display:block;margin-bottom:.2rem}
.faq-item p{margin:0;color:var(--ink-2);font-size:.9rem}
.connect-foot{margin-top:2.6rem;padding-top:1.3rem;border-top:1px solid var(--line);
  color:var(--ink-3);font-size:.88rem}

@media (max-width:820px){
  .claude-band{grid-template-columns:1fr;gap:1.1rem}
  .connect-grid{grid-template-columns:1fr}
  .faq-grid{grid-template-columns:1fr}
  .connect-head h1{font-size:1.66rem}
}
`;

/**
 * The only two client side behaviours on the site, both progressive.
 *
 * fcImgFallback keeps a missing photograph from blanking a card. Images come from the other
 * deployment, so a cold cache, a blocked origin or a typo in IMAGE_BASE_URL would otherwise
 * leave holes in the grid. The guard flag matters: without it a fallback that itself fails
 * would loop.
 *
 * fcGallery swaps the main product image. Written as one delegated listener rather than inline
 * handlers so the markup stays clean.
 */
const HEAD_SCRIPT = `
function fcImgFallback(el){
  if(el.getAttribute('data-fallback')==='1')return;
  el.setAttribute('data-fallback','1');
  var w=el.getAttribute('data-fw')||'300',h=el.getAttribute('data-fh')||'400';
  var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'">'
    +'<rect width="'+w+'" height="'+h+'" fill="#EFE7D6"/>'
    +'<g fill="#B3A68C" text-anchor="middle" font-family="Segoe UI,Helvetica,Arial,sans-serif">'
    +'<text x="'+(w/2)+'" y="'+(h/2)+'" font-size="'+Math.round(w/16)+'" font-weight="700" letter-spacing="1">FashionCart</text>'
    +'<text x="'+(w/2)+'" y="'+(h/2+Math.round(w/11))+'" font-size="'+Math.round(w/24)+'">Photo unavailable</text>'
    +'</g></svg>';
  el.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
document.addEventListener('click',function(e){
  var t=e.target.closest ? e.target.closest('.thumb') : null;
  if(!t)return;
  var main=document.getElementById('galleryMain');
  if(!main)return;
  main.src=t.getAttribute('data-full');
  main.removeAttribute('data-fallback');
  var all=document.querySelectorAll('.thumb');
  for(var i=0;i<all.length;i++)all[i].classList.remove('is-active');
  t.classList.add('is-active');
  t.setAttribute('aria-current','true');
});
`;

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="7" fill="#0F5C4A"/>' +
      '<text x="16" y="23" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="19" ' +
      'font-weight="700" fill="#F6F5F1" text-anchor="middle">F</text></svg>'
  );

export interface ImageOptions {
  src: string;
  alt: string;
  className?: string;
  /** Intrinsic-ish hint used only to size the inline SVG fallback. */
  fallbackWidth?: number;
  fallbackHeight?: number;
  /** Above the fold images skip lazy loading so the hero does not pop in. */
  eager?: boolean;
}

export function image(opts: ImageOptions): string {
  const cls = opts.className ? ` class="${escapeHtml(opts.className)}"` : "";
  const loading = opts.eager ? "eager" : "lazy";
  return (
    `<img${cls} src="${escapeHtml(opts.src)}" alt="${escapeHtml(opts.alt)}" ` +
    `loading="${loading}" decoding="async" ` +
    `data-fw="${opts.fallbackWidth ?? 300}" data-fh="${opts.fallbackHeight ?? 400}" ` +
    `onerror="fcImgFallback(this)">`
  );
}

const ICONS: Record<string, string> = {
  returns: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><polyline points="20 3.5 20 10 13.5 10"/>',
  truck:
    '<rect x="1.6" y="6" width="12.4" height="9.6" rx="1.6"/>' +
    '<path d="M14 9.2h3.9L21.4 12.6v3h-7.4z"/>' +
    '<circle cx="6" cy="18.2" r="1.9"/><circle cx="17.4" cy="18.2" r="1.9"/>',
  support:
    '<path d="M4.4 14.2v-2.1a7.6 7.6 0 0 1 15.2 0v2.1"/>' +
    '<rect x="2.2" y="13.4" width="4" height="6.2" rx="1.6"/>' +
    '<rect x="17.8" y="13.4" width="4" height="6.2" rx="1.6"/>',
  lock: '<rect x="4" y="10.4" width="16" height="9.8" rx="2.2"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/>',
  check: '<polyline points="4 12.8 9.2 18 20 6.6"/>',
  box: '<path d="M12 2.8 21 7.4v9.2L12 21.2 3 16.6V7.4z"/><path d="M3 7.4 12 12l9-4.6M12 12v9.2"/>',
  spark: '<path d="M12 3.2 14.1 9l5.9 2.1L14.1 13l-2.1 5.9L9.9 13 4 11.1 9.9 9z"/>',
};

export function icon(name: keyof typeof ICONS | string): string {
  const path = ICONS[name] ?? "";
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    path +
    "</svg>"
  );
}

export function stars(rating: number, reviewCount?: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const glyphs = "★".repeat(filled) + "☆".repeat(5 - filled);
  const count =
    reviewCount === undefined
      ? ""
      : ` <span class="tiny">(${escapeHtml(formatCount(reviewCount))})</span>`;
  return (
    `<span class="stars" aria-label="Rated ${escapeHtml(rating)} out of 5">` +
    `<span class="glyphs" aria-hidden="true">${glyphs}</span>` +
    `<span>${escapeHtml(rating.toFixed(1))}</span>${count}</span>`
  );
}

export function productCard(product: Product): string {
  const tag = product.memberOnly
    ? '<span class="tag tag--member">Member only</span>'
    : !product.inStock
      ? '<span class="tag tag--out">Sold out</span>'
      : "";

  const swatches = product.colours
    .slice(0, 4)
    .map(
      (c) =>
        `<i class="swatch" style="background:${escapeHtml(c.hex)}" title="${escapeHtml(c.name)}"></i>`
    )
    .join("");

  const discount =
    product.discountPct > 0
      ? `<span class="mrp">${escapeHtml(formatRupees(product.mrp))}</span>` +
        `<span class="off">${product.discountPct}% off</span>`
      : "";

  return `<a class="card" href="/product/${encodeURIComponent(product.id)}">
  <div class="card-media">
    ${image({ src: product.thumbnailUrl, alt: product.name, fallbackWidth: 300, fallbackHeight: 400 })}
    ${tag}
  </div>
  <div class="card-body">
    <p class="card-brand">${escapeHtml(product.brand)}</p>
    <h3 class="card-name">${escapeHtml(product.name)}</h3>
    <div class="price-row">
      <span class="price">${escapeHtml(formatRupees(product.price))}</span>
      ${discount}
    </div>
    <div class="card-foot">
      ${stars(product.rating)}
      <span class="swatches">${swatches}</span>
    </div>
  </div>
</a>`;
}

function wordmark(): string {
  return (
    '<a class="brand" href="/" aria-label="FashionCart home">' +
    "<span>Fashion</span><span class=\"brand-c\">Cart</span>" +
    '<span class="brand-dot" aria-hidden="true"></span></a>'
  );
}

function header(chrome: Chrome, activeCategory: string | null): string {
  if (chrome === "checkout") {
    return `<header class="site-header"><div class="wrap header-bar">
  ${wordmark()}
  <span class="header-note">${icon("lock")} Secure checkout</span>
</div></header>`;
  }

  const links = catalog.categories
    .map((slug) => {
      const active = slug === activeCategory ? ' class="is-active"' : "";
      return `<a href="/?category=${encodeURIComponent(slug)}"${active}>${escapeHtml(categoryLabel(slug))}</a>`;
    })
    .join("");

  return `<div class="announce">Free delivery over ${escapeHtml(formatRupees(FREE_DELIVERY_THRESHOLD))}<span>|</span>30 day returns<span>|</span>Made in India</div>
<header class="site-header"><div class="wrap header-bar">
  ${wordmark()}
  <nav class="nav" aria-label="Product categories">${links}</nav>
</div></header>`;
}

/**
 * The "shop this inside Claude" band, for the storefront pages.
 *
 * Never rendered on checkout. The checkout chrome is deliberately narrowed to show that
 * nothing competes for a shopper's attention once they are paying, and an advert there would
 * disprove the thing the demo exists to prove.
 */
export function claudeBand(): string {
  return `<aside class="claude-band">
  <div>
    <span class="claude-eyebrow">${icon("spark")} Shopping in AI assistants</span>
    <h2>Shop FashionCart inside Claude.</h2>
    <p>Claude is an AI assistant. Add one connector and the whole catalogue opens inside your
    conversation with it: filter it, pick your size, fill your bag. When you are ready to pay,
    it brings you back here.</p>
    <span class="band-note">Free on every Claude plan. No account and nothing to install.
    Other AI assistants planned.</span>
  </div>
  <a class="claude-cta" href="/connect">${icon("spark")} See how it works</a>
</aside>`;
}

/** The same offer, quieter, for the moment just after an order is placed. */
export function claudeMini(): string {
  return `<div class="claude-mini">
  <b>Next time, shop it inside Claude</b>
  <p>FashionCart runs inside Claude, the AI assistant. Ask for what you want, see it in a grid,
  and come back here only to pay.</p>
  <a href="/connect">Show me how</a>
</div>`;
}

function footer(): string {
  const year = new Date().getFullYear();
  return `<footer>
  <div class="trust"><div class="wrap trust-grid">
    <div class="trust-item">${icon("returns")}<div>
      <h3>30 day returns</h3>
      <p>Free pickup from your address. Refunds land back on your original method within 5 working days.</p>
    </div></div>
    <div class="trust-item">${icon("truck")}<div>
      <h3>Delivery across India</h3>
      <p>Free over ${escapeHtml(formatRupees(FREE_DELIVERY_THRESHOLD))}, otherwise ${escapeHtml(formatRupees(DELIVERY_FEE))}. Next day in eight metros.</p>
    </div></div>
    <div class="trust-item">${icon("support")}<div>
      <h3>Support, 9am to 9pm</h3>
      <p>Talk to a person on 1800 000 000, or write to care@fashioncart.example.</p>
    </div></div>
  </div></div>
  <div class="site-footer"><div class="wrap">
    <div class="footer-grid">
      <div>
        ${wordmark()}
        <p style="margin-top:.8rem">Everyday clothing cut for Indian weather, made in small runs with mills we can name.</p>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>${catalog.categories.map((c) => `<li>${escapeHtml(categoryLabel(c))}</li>`).join("")}</ul>
      </div>
      <div>
        <h4>Help</h4>
        <ul>
          <li>Track an order</li><li>Returns and exchanges</li>
          <li>Size guide</li><li>Contact us</li>
          <li><a href="/connect">Shop inside Claude</a></li>
        </ul>
      </div>
    </div>

    <div class="fineprint">
      <span>&copy; ${year} ${SITE_NAME}</span>
      <span>Demonstration storefront. Every brand, product and price here is fictional.</span>
      <span>No payment is taken and nothing ships.</span>
    </div>
  </div></div>
</footer>`;
}

export type Chrome = "full" | "checkout";

export interface PageOptions {
  title: string;
  description?: string;
  body: string;
  activeCategory?: string | null;
  /** "checkout" drops the category nav and promo bar, the way a real retailer narrows the
   *  header once the shopper is in the funnel. */
  chrome?: Chrome;
}

export function renderPage(opts: PageOptions): string {
  const chrome = opts.chrome ?? "full";
  const description =
    opts.description ??
    "FashionCart is a demonstration storefront for an assistant to merchant checkout handoff.";

  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)} | ${SITE_NAME}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex">
<link rel="icon" href="${FAVICON}">
<style>${STYLES}</style>
<script>${HEAD_SCRIPT}</script>
</head>
<body>
${header(chrome, opts.activeCategory ?? null)}
<main>
${opts.body}
</main>
${footer()}
</body>
</html>`;
}

export interface MessagePageOptions {
  title: string;
  eyebrow?: string;
  heading: string;
  paragraphs: string[];
  actions?: { href: string; label: string; primary?: boolean }[];
  chrome?: Chrome;
}

/** Every rejection path renders through here, so a shopper never meets a stack trace. */
export function renderMessagePage(opts: MessagePageOptions): string {
  const actions = (opts.actions ?? [])
    .map(
      (a) =>
        `<a class="btn ${a.primary ? "btn--primary" : "btn--ghost"}" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`
    )
    .join("");

  return renderPage({
    title: opts.title,
    chrome: opts.chrome ?? "full",
    body: `<div class="wrap"><div class="message">
  ${opts.eyebrow ? `<p class="eyebrow">${escapeHtml(opts.eyebrow)}</p>` : ""}
  <h1>${escapeHtml(opts.heading)}</h1>
  ${opts.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
  ${actions ? `<div class="message-actions">${actions}</div>` : ""}
</div></div>`,
  });
}
