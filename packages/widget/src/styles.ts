/**
 * Widget stylesheet, injected as a string.
 *
 * Sized against MEASURED host geometry (Phase 2 gate, probe 9, claude.ai web 2026-09-07):
 *   containerDimensions.width     735.98  -> three columns fit comfortably at ~228px
 *   containerDimensions.maxHeight 5000    -> a 24-card grid fits inline; no fullscreen needed
 *   availableDisplayModes         inline, fullscreen  -> there is NO pip, do not design one
 *   76 host CSS variables available
 *
 * Every host variable is used WITH a fallback. An undefined var with no fallback makes the whole
 * declaration invalid and the rule is dropped, which presents as "the widget looks broken".
 *
 * Transparent html/body plus the color-scheme meta is not cosmetic: Claude renders apps on a
 * transparent stack and without it the browser paints an opaque backdrop, which shows as a white
 * slab in dark mode. Verified working in both themes (probe 8).
 */

export const CSS = `
:root {
  --bg: transparent;
  --surface: var(--color-background-secondary, rgba(127,127,127,0.06));
  --surface-2: var(--color-background-tertiary, rgba(127,127,127,0.10));
  --text: var(--color-text-primary, #1c1c1e);
  --muted: var(--color-text-secondary, #6b6b73);
  --border: var(--color-border-primary, rgba(127,127,127,0.24));
  /* FashionCart brand green, set directly rather than through the host's accent so the store
     reads as its own brand inside the chat. */
  --accent: #0F5C4A;
  --accent-ink: #ffffff;
  --sale: #b3261e;
  --ok: #1f7a4d;
  --radius: var(--border-radius-md, 12px);
  --radius-sm: var(--border-radius-sm, 8px);
}
@media (prefers-color-scheme: dark) {
  :root {
    --text: var(--color-text-primary, #ececee);
    --muted: var(--color-text-secondary, #a0a0a8);
    --accent: #6FC2A4;
    --accent-ink: #0B1F18;
    --sale: #f87171;
    --ok: #4ade80;
  }
}

html, body { background: transparent; margin: 0; padding: 0; }
* { box-sizing: border-box; }

body {
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  padding: calc(4px + var(--safe-top,0px)) calc(4px + var(--safe-right,0px))
           calc(4px + var(--safe-bottom,0px)) calc(4px + var(--safe-left,0px));
}

.wrap { max-width: 100%; }

.bar {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.bar h2 { font-size: 14px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
.bar .count { color: var(--muted); font-size: 12px; }
.bar .spacer { flex: 1; }

/* filter chips and sort: client-side only, never a tool round trip */
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.chip {
  font: inherit; font-size: 11.5px; line-height: 1;
  padding: 6px 10px; border-radius: 999px;
  border: 1px solid var(--border); background: transparent; color: var(--text);
  cursor: pointer; white-space: nowrap;
}
.chip:hover { border-color: var(--accent); }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.chip .n { opacity: .65; margin-left: 4px; }
select.sort {
  font: inherit; font-size: 11.5px; padding: 5px 8px;
  border-radius: var(--radius-sm); border: 1px solid var(--border);
  background: transparent; color: var(--text);
}

/* GRID: three columns at the measured 736px, collapsing sensibly */
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
@media (max-width: 700px) { .grid { grid-template-columns: repeat(2, 1fr); } }
/* One column only below 340px. At 390px a single column produced a 16,526px page against the
   measured host maxHeight of 5000, so almost everything was clipped away unseen. */
@media (max-width: 340px) { .grid { grid-template-columns: 1fr; } }

/* CAROUSEL: one row, horizontal scroll, snap. Used for small result sets. */
.carousel {
  display: grid; grid-auto-flow: column; grid-auto-columns: 172px;
  gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory;
  padding-bottom: 6px; scrollbar-width: thin;
}
.carousel > * { scroll-snap-align: start; }

.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); overflow: hidden;
  display: flex; flex-direction: column;
}
.card:hover { border-color: var(--accent); }
.card .shot { position: relative; background: var(--surface-2); }
.card img { width: 100%; aspect-ratio: 4/5; object-fit: cover; display: block; }
.card .body { padding: 8px 9px 9px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
.card .brand { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.card .name {
  font-size: 12.5px; font-weight: 550; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
/* Unscoped 14 Oct 2026: the product view and the bag reuse this price markup outside a card,
   and rendered "Rs 1,899Rs 2,699" with no gap. Card rendering is unchanged. */
.price { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.now { font-weight: 650; font-size: 13px; }
.was { color: var(--muted); text-decoration: line-through; font-size: 11px; }
.card .off { color: var(--sale); font-size: 11px; font-weight: 600; }
.card .meta { font-size: 11px; color: var(--muted); }

.flag {
  position: absolute; top: 6px; left: 6px;
  font-size: 10px; font-weight: 650; letter-spacing: .03em;
  padding: 3px 6px; border-radius: 999px;
  background: var(--accent); color: var(--accent-ink);
}
.flag.oos { background: var(--surface-2); color: var(--muted); }

.swatches { display: flex; gap: 4px; align-items: center; }
.sw { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--border); }
.sizes { display: flex; gap: 3px; flex-wrap: wrap; }
.size {
  font: inherit; font-size: 10px; line-height: 1; padding: 3px 5px;
  border: 1px solid var(--border); border-radius: 4px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.size[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }

/* quantity stepper: the only mutating control in the widget */
.step { display: flex; align-items: center; gap: 0; margin-top: auto; }
.step button {
  font: inherit; width: 26px; height: 26px; line-height: 1;
  border: 1px solid var(--border); background: transparent; color: var(--text);
  cursor: pointer;
}
.step button:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.step button:last-of-type { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.step button:disabled { opacity: .4; cursor: default; }
.step .q { min-width: 30px; text-align: center; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); height: 26px; line-height: 26px; font-size: 12px; }
.step .add {
  flex: 1; height: 26px; border-radius: var(--radius-sm); font-size: 11.5px; font-weight: 600;
  border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); cursor: pointer;
}
.step .add:disabled { background: transparent; color: var(--muted); border-color: var(--border); }

.foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);
  font-size: 12px; color: var(--muted);
}
.foot strong { color: var(--text); }
.link {
  font: inherit; font-size: 12px; padding: 0; border: 0; background: none;
  color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
}
.empty { padding: 22px 6px; color: var(--muted); text-align: center; font-size: 12.5px; }
.err { color: var(--sale); }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
`;

export function injectStyles(): void {
  const el = document.createElement("style");
  el.textContent = CSS;
  document.head.appendChild(el);
}
