/**
 * Diagnostics view.
 *
 * This is the Phase 2 gate instrument, kept after the gate passed because it is the fastest way
 * to answer "is the connector healthy" on a new machine, a new account, or after a host update.
 * It was last run against claude.ai web on 2026-09-07.
 *
 * It is scaffolding rather than product. If the tool count ever becomes a concern (every tool
 * carrying ui-family _meta is appended to host-side tool_search results), this is the first
 * tool to drop.
 */

import { bridge } from "./bridge.js";
import { h, mount } from "./dom.js";
import { withImageFallback } from "./format.js";

type Status = "PASS" | "FAIL" | "WAIT" | "INFO";

interface Probe {
  n: number;
  label: string;
  status: Status;
  value: string;
  pre?: boolean;
}

export function renderDiagnostics(root: HTMLElement, data: Record<string, any>): void {
  const host = bridge.snapshot();
  const probeUrl = String(data.probeImageUrl ?? "");

  const probes: Probe[] = [
    { n: 1, label: "widget renders", status: "PASS", value: "you are reading this" },
    { n: 2, label: "image via resourceDomains", status: "WAIT", value: "loading..." },
    { n: 3, label: "iframe origin", status: "INFO", value: `${location.origin}  sandbox=${/claudemcpcontent\.com$/.test(location.hostname)}` },
    { n: 4, label: "host capabilities", status: bridge.isHosted ? "INFO" : "FAIL", value: JSON.stringify({ openLinks: bridge.can.openLinks, updateModelContext: bridge.can.updateModelContext, message: bridge.can.message }, null, 1), pre: true },
    { n: 5, label: "fetch-to-blob fallback", status: "WAIT", value: "loading..." },
    { n: 6, label: "openLink", status: "WAIT", value: "press the button" },
    { n: 7, label: "host context", status: "INFO", value: JSON.stringify(host, null, 1), pre: true },
    { n: 8, label: "declared CSP", status: "INFO", value: JSON.stringify(data.declaredCsp ?? {}, null, 1), pre: true },
  ];

  const byN = new Map(probes.map((p) => [p.n, p]));
  function set(n: number, status: Status, value: string): void {
    const p = byN.get(n);
    if (p) {
      p.status = status;
      p.value = value;
      draw();
    }
  }

  const direct = h("img", { alt: "direct", style: "width:56px;aspect-ratio:4/5;border-radius:6px;border:1px solid var(--border)" });
  const blob = h("img", { alt: "blob", style: "width:56px;aspect-ratio:4/5;border-radius:6px;border:1px solid var(--border)" });

  function draw(): void {
    mount(
      root,
      h(
        "div",
        { class: "wrap" },
        h("div", { class: "bar" }, h("h2", {}, "FashionCart diagnostics"), h("span", { class: "count" }, `server ${data.serverVersion ?? "?"} · MCP ${data.protocol ?? "?"} · UI ${data.uiProtocol ?? "?"}`)),
        h(
          "table",
          { style: "width:100%;border-collapse:collapse;font-size:12px" },
          ...probes.map((p) =>
            h(
              "tr",
              {},
              h("td", { style: "padding:5px 6px 5px 0;border-top:1px solid var(--border);color:var(--muted);width:18px" }, String(p.n)),
              h("td", { style: "padding:5px 6px 5px 0;border-top:1px solid var(--border);width:170px" }, p.label),
              h("td", { style: `padding:5px 6px 5px 0;border-top:1px solid var(--border);width:48px;font-weight:650;color:${p.status === "PASS" ? "var(--ok)" : p.status === "FAIL" ? "var(--sale)" : "var(--muted)"}` }, p.status),
              h("td", { class: "meta mono", style: "padding:5px 0;border-top:1px solid var(--border);word-break:break-word" }, p.pre ? h("pre", { style: "margin:0;white-space:pre-wrap;max-height:120px;overflow:auto" }, p.value) : p.value)
            )
          )
        ),
        h("div", { style: "display:flex;gap:10px;align-items:center;margin-top:10px" }, direct, blob),
        h(
          "div",
          { class: "foot" },
          h(
            "button",
            {
              class: "chip",
              type: "button",
              disabled: !bridge.can.openLinks,
              onclick: async () => {
                set(6, "WAIT", "called openLink; expect a confirmation modal");
                const ok = await bridge.openLink(probeUrl || "https://example.com/");
                set(6, ok ? "PASS" : "FAIL", ok ? "resolved; a modal is shown on every handoff (verified 2026-09-07)" : "openLink threw");
              },
            },
            "Test openLink"
          )
        )
      )
    );
    bridge.reportHeight(root.getBoundingClientRect().height + 16);
  }

  draw();

  if (probeUrl) {
    const t0 = performance.now();
    direct.onload = () => set(2, "PASS", `displayed ${direct.naturalWidth}x${direct.naturalHeight} in ${Math.round(performance.now() - t0)}ms`);
    direct.onerror = () => set(2, "FAIL", "blocked: resourceDomains did not reach img-src");
    direct.src = probeUrl;

    void (async () => {
      const t1 = performance.now();
      try {
        const res = await fetch(probeUrl, { mode: "cors" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const b = await res.blob();
        blob.src = URL.createObjectURL(b);
        set(5, "PASS", `fetched ${b.size} B via connect-src in ${Math.round(performance.now() - t1)}ms`);
      } catch (err) {
        set(5, "FAIL", `blocked: ${(err as Error).message}`);
        withImageFallback(blob, "");
      }
    })();
  } else {
    set(2, "FAIL", "no probeImageUrl in structuredContent");
    set(5, "FAIL", "no probeImageUrl in structuredContent");
  }
}
