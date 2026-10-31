/**
 * Widget entry point.
 *
 * One ui:// resource backs every tool, so this file is a router: it reads the `kind`
 * discriminator the server puts on structuredContent and hands off to a view. Inferring the
 * view from the tool name would be fragile, since the host does not guarantee to pass it.
 *
 * Nothing here imports the SDK. All host contact goes through ./bridge, which exists so that
 * no host dialect leaks into view code and so capability checks stay in one place.
 */

import { bridge, type HostSnapshot, type ViewKind } from "./bridge.js";
import { injectStyles } from "./styles.js";
import { renderStorefront, setCartId, type SearchPayload } from "./storefront.js";
import { renderCart, renderCheckout, renderProduct, renderUnknown } from "./views.js";
import { renderDiagnostics } from "./diagnostics.js";
import { h, mount } from "./dom.js";

injectStyles();

const root = document.getElementById("root") ?? document.body.appendChild(h("div", { id: "root" }));

function applyHostContext(host: HostSnapshot): void {
  // Safe-area insets are consumed by the stylesheet via these custom properties. They are zero
  // on desktop web but real on mobile, where the conversation view owns vertical panning.
  const s = document.documentElement.style;
  s.setProperty("--safe-top", `${host.safeArea.top}px`);
  s.setProperty("--safe-right", `${host.safeArea.right}px`);
  s.setProperty("--safe-bottom", `${host.safeArea.bottom}px`);
  s.setProperty("--safe-left", `${host.safeArea.left}px`);
  // Theme comes through host CSS variables, which the stylesheet already consumes with
  // fallbacks. This attribute exists only so a view can branch if it ever needs to.
  document.documentElement.dataset.theme = host.theme;
}

let last: { kind: ViewKind; data: Record<string, unknown> } | null = null;

function route(kind: ViewKind, data: Record<string, unknown>): void {
  last = { kind, data };
  switch (kind) {
    case "search":
      renderStorefront(root as HTMLElement, data as unknown as SearchPayload);
      break;
    case "cart":
      if ((data.cart as any)?.cartId) setCartId((data.cart as any).cartId);
      renderCart(root as HTMLElement, data);
      break;
    case "checkout":
      if ((data.cart as any)?.cartId) setCartId((data.cart as any).cartId);
      renderCheckout(root as HTMLElement, data);
      break;
    case "product":
      renderProduct(root as HTMLElement, data);
      break;
    case "diagnostics":
      renderDiagnostics(root as HTMLElement, data);
      break;
    default:
      renderUnknown(root as HTMLElement, data);
  }
}

mount(root, h("div", { class: "empty" }, "Loading FashionCart..."));

void bridge
  .start({
    onResult: route,
    onContext: (host) => {
      applyHostContext(host);
      // Re-render on theme or size change so the view picks up new host variables and the
      // reported height stays accurate.
      if (last) route(last.kind, last.data);
    },
  })
  .catch((err: unknown) => {
    mount(
      root,
      h("div", { class: "empty err" }, `Could not connect to the host: ${(err as Error).message}`),
      h("div", { class: "meta mono", style: "text-align:center" }, "See docs/TROUBLESHOOTING.md")
    );
  });

/**
 * Standalone preview escape hatch.
 *
 * With no host, connect() never resolves, so the widget would sit on "Loading" forever. The
 * preview harness sets window.__FASHIONCART_PREVIEW__ to a search payload before this module
 * runs; if it is present and nothing has arrived from a host, render it. This is what makes
 * `preview.html` work with no Claude account and no tunnel.
 */
setTimeout(() => {
  const preview = (window as any).__FASHIONCART_PREVIEW__;
  if (!last && preview) {
    applyHostContext(bridge.snapshot());
    route("search", preview);
  }
}, 1200);
