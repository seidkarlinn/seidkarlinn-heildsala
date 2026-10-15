/**
 * Netlify Edge Function — remove-brands
 *
 * 2026-10-15: Fjarlægir allar Cosanea vörur úr heildsöluvörulistanum
 *   (9 vörur: tannkrem, áfyllingar og viðartannbursti).
 * 2026-10-15 (2): Fjarlægir líka kolloidal silfur (Seiðkarlinn colloidal
 *   silver 50ml og 1l).
 *
 * Strips every product object whose "name" matches one of REMOVED_NAMES
 * from the PRODUCTS array in index.html, so the products are gone for every
 * visitor — admin included — and cannot be restored from the admin panel.
 * Same pattern as inject-catalog: index.html (~500 KB) cannot be pushed
 * through the GitHub connector. Once index.html no longer contains the
 * blocks, this is a no-op and can be retired.
 *
 * To remove more products, add a name pattern to REMOVED_NAMES.
 *
 * Declared LAST in netlify.toml (innermost wrapper), so it edits the origin
 * HTML before any other edge function sees it.
 */

const REMOVED_NAMES = [
  /^Cosanea\b/i,
  /colloidal silver/i,
];

// One pretty-printed PRODUCTS entry: "  {" … "name": "…" … "  }," — the lazy
// body may not cross into the next "  {" object.
const PRODUCT_BLOCK =
  /\n  \{\r?\n\s*"name":\s*"([^"]*)"(?:(?!\n  \{)[\s\S])*?\n  \},?(?=\r?\n)/g;

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  html = html.replace(PRODUCT_BLOCK, (block, name) =>
    REMOVED_NAMES.some((re) => re.test(name)) ? '' : block
  );
  // Removing the last element can leave "},\n]" — legal in a JS array
  // literal, so no further clean-up is needed.

  return new Response(html, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
