/**
 * Vercel entrypoint (Express framework preset), and the single place the app is assembled.
 *
 * Vercel detects Express from the dependency list and then looks for an entrypoint at exactly
 * one of:
 *
 *   app|index|server.{js,cjs,mjs,ts,cts,mts}
 *   src/app|src/index|src/server.{js,cjs,mjs,ts,cts,mts}
 *
 * It also requires that entrypoint to import express DIRECTLY. Re-exporting an app assembled in
 * another module is not enough: the check is static, and the sibling connector package burned
 * two deploys learning it ("No entrypoint found which imports express"). So the import below is
 * load bearing, and the app is built here rather than in an app.ts that this file forwards to.
 *
 * The preset accepts either a default exported app or a port listener. Default export is used
 * here because a serverless function is invoked rather than bound; main.ts adds the listener for
 * local development, so both paths run exactly the same routing code.
 */

import express from "express";

import { catalog } from "./catalog.js";
import { renderMessagePage } from "./layout.js";
import { createCheckoutRouter } from "./routes/checkout.js";
import { createHealthRouter } from "./routes/health.js";
import { createConnectRouter } from "./routes/connect.js";
import { createHomeRouter } from "./routes/home.js";
import { createOrderRouter } from "./routes/order.js";
import { createPaymentRouter } from "./routes/payment.js";
import { createProductRouter } from "./routes/product.js";

const app = express();

// Serverless instances are shared, and nothing here needs to know the client IP.
app.disable("x-powered-by");
app.set("trust proxy", true);

// The only body this site parses. There is no JSON API and no file upload, and the limit is
// small on purpose: the largest legitimate post is a token plus four short address fields.
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.use(createHealthRouter());
app.use(createHomeRouter());
app.use(createConnectRouter());
app.use(createProductRouter());
app.use(createCheckoutRouter());
app.use(createPaymentRouter());
app.use(createOrderRouter());

app.use((_req, res) => {
  res.status(404).send(
    renderMessagePage({
      title: "Page not found",
      eyebrow: "404",
      heading: "That page is not here",
      paragraphs: [
        "The link may be out of date, or it may have picked up a stray character on the way.",
      ],
      actions: [{ href: "/", label: "Back to the storefront", primary: true }],
    })
  );
});

/**
 * Last resort. Express needs all four parameters for this to register as an error handler.
 *
 * The message is deliberately generic and the detail goes to the log: an exception string on a
 * storefront page is both a poor experience and an information leak.
 */
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ): void => {
    console.error("[fashioncart-merchant] unhandled error", err);
    if (res.headersSent) return;
    res.status(500).send(
      renderMessagePage({
        title: "Something went wrong",
        eyebrow: "Error",
        heading: "Something went wrong at our end",
        paragraphs: [
          "Nothing has been charged. Please try again in a moment.",
          "If you were checking out, your assistant can send a fresh checkout link.",
        ],
        actions: [{ href: "/", label: "Back to the storefront", primary: true }],
      })
    );
  }
);

console.log(
  "[fashioncart-merchant] catalog: " +
    catalog.products.length +
    " products, " +
    catalog.categories.length +
    " categories"
);

export default app;
