import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The widget must be ONE self-contained HTML file.
 *
 * The MCP server returns it as the text of the ui:// resource, and the host injects that string
 * into a sandboxed iframe with document.write. There is no second request the iframe could make
 * for a .js or .css sibling - and even if there were, the enforced CSP's 'self' is the host's
 * sandbox origin, not ours. So everything is inlined.
 */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: "mcp-app.html" },
    // Inlining is the whole point; raise the limits so nothing is emitted as a separate asset.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    target: "es2022",
  },
});
