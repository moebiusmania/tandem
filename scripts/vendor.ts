// Copies third-party browser assets from node_modules into public/vendor so they are served same-origin (strict CSP, no CDN).
import { copyFileSync, mkdirSync } from "node:fs";
const files: [string, string][] = [
  ["node_modules/htmx.org/dist/htmx.min.js", "public/vendor/htmx.min.js"],
  ["node_modules/@alpinejs/csp/dist/cdn.min.js", "public/vendor/alpine-csp.min.js"],
  ["node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "public/vendor/fonts/inter.woff2"],
  ["node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", "public/vendor/fonts/space-grotesk.woff2"],
];
mkdirSync("public/vendor/fonts", { recursive: true });
for (const [from, to] of files) copyFileSync(from, to);
console.log(`vendored ${files.length} files`);
