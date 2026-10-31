/**
 * The host adapter. THE ONLY FILE THAT IMPORTS @modelcontextprotocol/ext-apps.
 *
 * Everything else in the widget talks to `bridge`, never to `App`. Two reasons:
 *
 *  1. If a second host dialect ever needs supporting, the change lands here and nowhere else.
 *     No component should know which assistant it is running inside.
 *
 *  2. It forces capability checks to be centralised. OpenAI's own guidance is explicit:
 *     "Avoid branching on a host or product name. Test for the capability your UI needs."
 *     So `bridge.can.openLinks` is a real query against getHostCapabilities(), not a guess.
 *
 * VERIFIED host capabilities on claude.ai web, 2026-09-07 (Phase 2 gate, probe 5):
 *   openLinks, downloadFile, serverTools{listChanged}, serverResources{listChanged},
 *   logging, sandbox{csp}, updateModelContext{text,image}, message{text}
 * Notably ABSENT: sampling. Do not design around it.
 */

import { App } from "@modelcontextprotocol/ext-apps";

export type ViewKind = "search" | "product" | "cart" | "checkout" | "diagnostics" | "unknown";

export interface HostSnapshot {
  theme: "light" | "dark";
  displayMode: string;
  availableDisplayModes: string[];
  width: number;
  maxHeight: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  locale: string;
  timeZone: string;
}

/** Measured on claude.ai web: width 735.98, maxHeight 5000. Used only before the host answers. */
const FALLBACK: HostSnapshot = {
  theme: "light",
  displayMode: "inline",
  availableDisplayModes: ["inline"],
  width: 736,
  maxHeight: 5000,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  locale: "en-IN",
  timeZone: "Asia/Kolkata",
};

type ResultHandler = (kind: ViewKind, data: Record<string, unknown>) => void;
type ContextHandler = (host: HostSnapshot) => void;

class Bridge {
  private app = new App({ name: "FashionCart", version: "0.1.0" });
  private connected = false;
  private onResult: ResultHandler = () => {};
  private onContext: ContextHandler = () => {};

  /** What the host says it can do. Empty until connect() resolves; never assume a key exists. */
  private caps: Record<string, unknown> = {};

  get can(): { openLinks: boolean; updateModelContext: boolean; message: boolean; displayMode: boolean } {
    return {
      openLinks: "openLinks" in this.caps,
      updateModelContext: "updateModelContext" in this.caps,
      message: "message" in this.caps,
      displayMode: (this.snapshot().availableDisplayModes?.length ?? 0) > 1,
    };
  }

  /** True once a host has actually answered. False in the standalone preview. */
  get isHosted(): boolean {
    return this.connected;
  }

  snapshot(): HostSnapshot {
    const ctx = this.app.getHostContext() as Record<string, any> | undefined;
    if (!ctx) return FALLBACK;
    return {
      theme: ctx.theme === "dark" ? "dark" : "light",
      displayMode: ctx.displayMode ?? FALLBACK.displayMode,
      availableDisplayModes: ctx.availableDisplayModes ?? FALLBACK.availableDisplayModes,
      width: ctx.containerDimensions?.width ?? FALLBACK.width,
      maxHeight: ctx.containerDimensions?.maxHeight ?? FALLBACK.maxHeight,
      safeArea: ctx.safeAreaInsets ?? FALLBACK.safeArea,
      locale: ctx.locale ?? FALLBACK.locale,
      timeZone: ctx.timeZone ?? FALLBACK.timeZone,
    };
  }

  /**
   * Register handlers and connect.
   *
   * The ordering here is not stylistic. Handlers assigned AFTER connect() never fire, and that
   * is the single most commonly reported cause of a widget that mounts and then sits empty.
   * Everything is wired before the call, and the call is the last thing this method does.
   */
  async start(handlers: { onResult: ResultHandler; onContext: ContextHandler }): Promise<void> {
    this.onResult = handlers.onResult;
    this.onContext = handlers.onContext;

    this.app.ontoolresult = (params: any) => {
      const sc = params?.structuredContent as Record<string, unknown> | undefined;
      if (!sc) {
        // Claude Desktop on macOS has been reported to deliver tool-result with no
        // structuredContent at all. Surface it rather than rendering an empty shell.
        this.onResult("unknown", { error: "tool result arrived with no structuredContent" });
        return;
      }
      const kind = (typeof sc.kind === "string" ? sc.kind : "unknown") as ViewKind;
      this.onResult(kind, sc);
    };

    this.app.onhostcontextchanged = () => this.onContext(this.snapshot());

    this.app.onteardown = () => ({});

    await this.app.connect();
    this.connected = true;
    this.caps = (this.app.getHostCapabilities() as Record<string, unknown>) ?? {};
    this.onContext(this.snapshot());
  }

  /** Call a tool on our own server. Used by the quantity steppers. */
  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!this.connected) return null;
    const res: any = await this.app.callServerTool({ name, arguments: args });
    return (res?.structuredContent as Record<string, unknown>) ?? null;
  }

  /**
   * Open an external URL.
   *
   * VERIFIED 2026-09-07: on a custom (non-directory) connector Claude always shows an
   * "Open external link" confirmation modal with the full URL, Cancel focused, and NO
   * "always allow" option. It therefore appears on every single handoff. That is expected
   * behaviour, not a fault, and the demo script leans on it.
   */
  async openLink(url: string): Promise<boolean> {
    if (!this.can.openLinks) return false;
    try {
      await this.app.openLink({ url });
      return true;
    } catch {
      return false;
    }
  }

  /** Put text into the conversation so the model can act on what the user did in the widget. */
  async tellModel(text: string): Promise<void> {
    if (!this.can.updateModelContext) return;
    try {
      await this.app.updateModelContext({ content: [{ type: "text", text }] });
    } catch {
      /* non-fatal: the widget is still usable if the model is not told */
    }
  }

  /**
   * Report height.
   *
   * Both mechanisms, deliberately. claude.ai is reported to ignore size-changed and read the
   * document height directly, so an explicit documentElement height is the one that actually
   * works; the notification is there for hosts that do honour it.
   */
  reportHeight(px: number): void {
    const h = Math.max(1, Math.ceil(px));
    document.documentElement.style.height = `${h}px`;
    // sendSizeChanged returns a Promise. A try/catch cannot catch a REJECTION, only a synchronous
    // throw - so without the .catch() an unconnected app produces an unhandled rejection
    // ("Not connected") that surfaces as a pageerror. Caught in the standalone preview, where
    // there is no host at all.
    try {
      (this.app as any).sendSizeChanged?.({ height: h })?.catch?.(() => {});
    } catch {
      /* host may not implement it */
    }
  }
}

export const bridge = new Bridge();
