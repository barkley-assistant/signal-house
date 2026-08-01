/**
 * Build the web SPA to dist/public/. Called by `bun run build`.
 */

import { resolve } from "node:path";
import { buildWebBundle, publicDirFor } from "../src/shared/web-assets";

const root = resolve(import.meta.dir, "..");
await buildWebBundle(publicDirFor(root));
console.log("web bundle → dist/public");
