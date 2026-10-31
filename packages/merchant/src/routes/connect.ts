/**
 * "Shop FashionCart inside Claude": the instructions page behind the storefront CTA.
 *
 * A page of its own rather than a section on the home page. The steps run to a screenful on
 * mobile, and a storefront that explains its own plumbing above the fold stops reading as a
 * storefront, which is the one thing this site has to keep doing.
 *
 * Deliberately never linked from the checkout chrome. The narrowed checkout header exists to
 * show that nothing distracts a shopper mid-purchase, and putting a CTA there would contradict
 * the exact behaviour the demo is meant to prove.
 *
 * House style: no em dashes and no en dashes in anything a visitor can read.
 */

import { Router } from "express";

import { escapeHtml, icon, renderPage } from "../layout.js";

/** Read from the environment so a preview deployment tells the truth about its own URL. */
function mcpUrl(): string {
  const raw = process.env.FC_MCP_URL || "http://localhost:3001/mcp";
  return raw.replace(/\/+$/, "");
}

const STEPS: [string, string][] = [
  [
    "Open connector settings in Claude",
    "On the web go to Settings, then Connectors. In the desktop app it is the same place. " +
      "You will need to be signed in to a Claude account.",
  ],
  [
    "Choose Add custom connector",
    "Claude asks for a name and a URL. Any name works; FashionCart is the obvious one.",
  ],
  [
    "Paste the connector URL",
    "That is the address below. There is no key, no sign in and no account to create, because " +
      "this demonstration catalogue is public and fictional.",
  ],
  [
    "Start a new chat and ask for something",
    "Try “Show me kurtas under 2000” or “I need a shirt for the office”. " +
      "A product grid appears inside the conversation. Pick a size, add to your bag, and check " +
      "out when you are ready.",
  ],
];

const FAQ: [string, string][] = [
  [
    "Does this cost anything?",
    "No. It works on every Claude plan, including the free one. Nothing here charges you and " +
      "no payment is ever taken.",
  ],
  [
    "Why does it say Beta?",
    "Claude labels every custom connector that way. It describes the connector feature, not " +
      "this storefront.",
  ],
  [
    "What can it see?",
    "The catalogue and whatever you type at it. There is no account, so there is nothing " +
      "personal for it to read. Your conversation stays between you and Claude.",
  ],
  [
    "Is this a real shop?",
    "No. Every brand, product and price is invented, no payment is taken and nothing ships. " +
      "It is a working demonstration of a storefront inside an AI assistant.",
  ],
  [
    "Can I take it off again?",
    "Yes, from the same Connectors screen. Removing it takes one click and leaves nothing " +
      "behind.",
  ],
];

export function createConnectRouter(): Router {
  const router = Router();

  router.get("/connect", (_req, res) => {
    const url = mcpUrl();
    res.type("html").send(
      renderPage({
        title: "Shop FashionCart inside Claude",
        description:
          "Add the FashionCart connector to Claude and browse the whole catalogue " +
          "without leaving the conversation.",
        body: `<div class="wrap connect">
  <header class="connect-head">
    <span class="pill-live">${icon("spark")} Live now in Claude</span>
    <h1>Shop FashionCart inside Claude, the AI assistant.</h1>
    <p class="lede">Add one connector and Claude can show you this whole catalogue, in a grid
    you can filter and add to your bag from. When you are ready to pay it brings you back here,
    to this site, exactly as it does today.</p>
  </header>

  <div class="connect-grid">
    <section class="connect-steps">
      <h2 class="sec-title">Four steps, about a minute</h2>
      <ol class="howto">
        ${STEPS.map(
          ([head, body]) => `<li>
          <b>${escapeHtml(head)}</b>
          <p>${escapeHtml(body)}</p>
        </li>`
        ).join("")}
      </ol>

      <div class="urlbox">
        <span class="urlbox-label">Connector URL</span>
        <code>${escapeHtml(url)}</code>
        <p class="tiny muted" style="margin:.6rem 0 0">Copy the whole line, including https.</p>
      </div>
    </section>

    <aside class="connect-side">
      <div class="panel">
        <p class="panel-title">What you can ask for</p>
        <ul class="asks">
          <li>Show me kurtas under 2000</li>
          <li>I need a shirt for the office</li>
          <li>What is this made of?</li>
          <li>Add the medium to my bag</li>
          <li>What is in my bag?</li>
        </ul>
        <p class="tiny muted" style="margin:.9rem 0 0">Ask in your own words. It is a
        conversation, not a set of commands.</p>
      </div>

      <div class="panel panel--quiet">
        <div class="assure">${icon("lock")}<span><b>Payment never happens in the chat.</b>
        Claude asks before it brings you here, and your card details are only ever entered on
        this site.</span></div>
        <div class="assure">${icon("check")}<span>No account, no key and nothing to
        install.</span></div>
      </div>

      <div class="soon">
        <span class="soon-tag">Planned</span>
        <p><b>Other assistants</b></p>
        <p class="small muted">The storefront is built on an open standard, and the same
        connector is designed to run in ChatGPT and other assistants that adopt it. That is not
        switched on yet. Claude is the one place it works today.</p>
      </div>
    </aside>
  </div>

  <section class="faq">
    <h2 class="sec-title">Questions people ask</h2>
    <div class="faq-grid">
      ${FAQ.map(
        ([q, a]) => `<div class="faq-item">
        <b>${escapeHtml(q)}</b>
        <p>${escapeHtml(a)}</p>
      </div>`
      ).join("")}
    </div>
  </section>

  <p class="connect-foot">A working demonstration of a storefront inside an AI assistant. <a href="/">Back to the shop</a></p>
</div>`,
      })
    );
  });

  return router;
}
