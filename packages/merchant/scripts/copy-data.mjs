/**
 * Stage the shared catalog feed inside this package so Vercel bundles it.
 *
 * The feed is authored once at <repo>/data and read from there in local development. A Vercel
 * function root is this package, so anything above it is invisible to the bundler, and
 * vercel.json's includeFiles: "data/**" can only include files that live here. Copying at
 * deploy time keeps "swap catalog.json to swap the catalog" true in both places, and
 * src/catalog.ts prefers this copy only when VERCEL is set, so a staged copy left behind on a
 * dev machine can never shadow a local edit to the authored feed.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../data");
const DST = resolve(HERE, "../data");

// fulfilment.json is optional at runtime (delivery estimates fall back to a national default),
// but it is always staged when present so the deployed site matches local behaviour.
const REQUIRED = ["catalog.json"];
const OPTIONAL = ["fulfilment.json"];

mkdirSync(DST, { recursive: true });

for (const file of REQUIRED) {
  const from = resolve(SRC, file);
  if (!existsSync(from)) {
    console.error(`[copy-data] MISSING ${from}`);
    process.exit(1);
  }
  copyFileSync(from, resolve(DST, file));
  console.log(`[copy-data] ${file}`);
}

for (const file of OPTIONAL) {
  const from = resolve(SRC, file);
  if (!existsSync(from)) {
    console.warn(`[copy-data] optional ${file} not found, skipping`);
    continue;
  }
  copyFileSync(from, resolve(DST, file));
  console.log(`[copy-data] ${file}`);
}

console.log(`[copy-data] feed staged at ${DST}`);
