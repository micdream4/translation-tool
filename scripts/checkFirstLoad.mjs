// Checks the built page (dist/) after `npm run build`: the first download must not include the
// format libraries (PDF, Excel, DOCX writer, Gemini SDK). They load only when a file of that type
// is opened. Follows the static imports of the entry chunk, so a library pulled in indirectly is
// caught too, and reports the gzip size of everything loaded up front.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const distDir = path.resolve(import.meta.dirname, "../dist");
const MAX_FIRST_LOAD_GZIP_KB = Number(process.env.MAX_FIRST_LOAD_GZIP_KB || 320);
const FORBIDDEN = [/vendor-pdf/, /vendor-xlsx/, /vendor-docx/, /vendor-genai/, /pdf\.worker/];

const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
const entries = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]);
const seen = new Set();
const queue = [...entries];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const source = fs.readFileSync(path.join(distDir, file), "utf8");
  // Static imports only: `import ... from "./x.js"` and bare `import "./x.js"`; import() is lazy.
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)"\.\/([^"]+\.js)"/g)) {
    queue.push(`assets/${match[1]}`);
  }
}

const loaded = [...seen];
const forbidden = loaded.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
const gzipKb =
  loaded.reduce((total, file) => total + zlib.gzipSync(fs.readFileSync(path.join(distDir, file))).length, 0) / 1024;

console.log(`First load: ${loaded.length} scripts, ${gzipKb.toFixed(0)} KB gzip`);
loaded.forEach((file) => console.log(`  ${file}`));
if (forbidden.length) {
  console.error(`Format libraries in the first load: ${forbidden.join(", ")}`);
  process.exit(1);
}
if (gzipKb > MAX_FIRST_LOAD_GZIP_KB) {
  console.error(`First load is ${gzipKb.toFixed(0)} KB gzip, over the ${MAX_FIRST_LOAD_GZIP_KB} KB budget.`);
  process.exit(1);
}
