/**
 * Stage everything the deployed function reads from disk into this package.
 *
 * A Vercel function root is this package; anything above it is invisible to the bundler, and
 * `includeFiles` only reaches paths inside the root. Two things live outside it:
 *
 *   ../../data/*.json            the authored catalog feed
 *   ../widget/dist/mcp-app.html  the built widget bundle
 *
 * Both are copied under ./data so a SINGLE includeFiles glob ("data/**") covers them.
 * includeFiles takes one string, not an array, so a second top-level directory would need
 * brace expansion that is not documented as supported. Putting the widget under data/ is
 * slightly odd naming for a clean guarantee.
 *
 * The alternative - moving the sources into this package - was rejected because it would break
 * "replace data/catalog.json to swap the catalog", which is a first-class requirement.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DST = resolve(HERE, "../data");
const WIDGET_DST = resolve(DST, "widget");

const jobs = [
  { from: resolve(HERE, "../../../data/catalog.json"), to: resolve(DST, "catalog.json"), required: true },
  { from: resolve(HERE, "../../../data/fulfilment.json"), to: resolve(DST, "fulfilment.json"), required: true },
  {
    from: resolve(HERE, "../../widget/dist/mcp-app.html"),
    to: resolve(WIDGET_DST, "mcp-app.html"),
    required: false,
    hint: "run `npm run build` in packages/widget first, or the deploy ships the placeholder",
  },
];

mkdirSync(DST, { recursive: true });
mkdirSync(WIDGET_DST, { recursive: true });

let missing = 0;
for (const j of jobs) {
  if (!existsSync(j.from)) {
    if (j.required) {
      console.error(`[stage] MISSING ${j.from}`);
      process.exit(1);
    }
    console.warn(`[stage] SKIP  ${j.from}\n        ${j.hint}`);
    missing++;
    continue;
  }
  copyFileSync(j.from, j.to);
  console.log(`[stage] ${j.to.replace(resolve(HERE, ".."), ".")}  (${statSync(j.to).size.toLocaleString()} B)`);
}

if (missing) {
  console.warn(`[stage] ${missing} optional file(s) missing - the deploy will use fallbacks.`);
}
