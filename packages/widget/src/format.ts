/**
 * Formatting and the image fallback ladder.
 *
 * Money is integer rupees throughout. Nothing here ever produces a decimal, because nothing
 * upstream ever produces one: the server re-prices in whole rupees and the widget only displays.
 */

/** Indian digit grouping (lakh/crore), e.g. 123456 -> "Rs 1,23,456". */
export function rupees(n: number): string {
  const s = String(Math.abs(Math.round(n)));
  const sign = n < 0 ? "-" : "";
  if (s.length <= 3) return `${sign}Rs ${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}Rs ${rest},${last3}`;
}

export function pct(n: number): string {
  return `${Math.round(n)}% off`;
}

/**
 * Inline SVG placeholder: the terminal rung of the image fallback ladder.
 *
 * Lives in the bundle as a constant rather than being sent per product. An earlier costing
 * charged it per row and concluded it cost 19,184 chars in a 24-product response; that was
 * wrong. It costs nothing on the wire.
 *
 * `data:` is permitted by the default sandbox CSP with no declaration, so this works even if
 * every other rung fails.
 */
export function placeholderSvg(label = "Image unavailable"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200" role="img" aria-label="${label}">` +
    `<rect width="160" height="200" fill="#EEE9E0"/>` +
    `<path d="M46 32h68l18 30-14 8v92H42V70l-14-8z" fill="#D8D2C6"/>` +
    `<circle cx="80" cy="150" r="3" fill="#B9B1A2"/></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/**
 * Attach the fallback ladder to an <img>.
 *
 * Rung 1 (a plain same-origin URL, with the domain declared in resourceDomains) is VERIFIED
 * working on claude.ai as of 2026-09-07, which refutes ext-apps issue #761. Rung 2
 * (fetch to blob, riding connectDomains -> connect-src) is also verified live and is wired
 * here as the automatic fallback, because it fails independently of rung 1: different CSP
 * directive, different failure mode.
 */
export function withImageFallback(img: HTMLImageElement, url: string): void {
  let stage: "direct" | "blob" | "svg" = "direct";

  img.onerror = async () => {
    if (stage === "direct") {
      stage = "blob";
      try {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw new Error(String(res.status));
        img.src = URL.createObjectURL(await res.blob());
        return;
      } catch {
        /* fall through */
      }
    }
    stage = "svg";
    img.onerror = null;
    img.src = placeholderSvg();
  };

  img.src = url;
}

export function thumbUrl(base: string, template: string, id: string): string {
  return base + template.replace("{id}", id);
}
