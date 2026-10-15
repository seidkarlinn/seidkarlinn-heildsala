/**
 * Netlify Edge Function — remove-brands
 *
 * 2026-10-15: Fjarlægir allar Cosanea vörur úr heildsöluvörulistanum
 *   (9 vörur: tannkrem, áfyllingar og viðartannbursti).
 *
 * Strips every product object whose "name" starts with a brand listed in
 * REMOVED_BRANDS from the PRODUCTS array in index.html, so the products are
 * gone for every visitor — admin included — and cannot be restored from the
 * admin panel. Same pattern as inject-catalog: index.html (~500 KB) cannot be
 * pushed through the GitHub connector. Once index.html no longer contains the
 * blocks, this is a no-op and can be retired.
 *
 * Declared LAST in netlify.toml (innermost wrapper), so it edits the origin
 * HTML before any other edge function sees it.
 */

const REMOVED_BRANDS = ['Cosanea'];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  if (!REMOVED_BRANDS.some((b) => html.includes(b))) {
    return new Response(html, { status: response.status, headers: response.headers });
  }

  for (const brand of REMOVED_BRANDS) {
    // One pretty-printed PRODUCTS entry: "  {" … "name": "<Brand>…" … "  },"
    // Lazy body that may not cross into the next "  {" object.
    const re = new RegExp(
      '\\n  \\{\\r?\\n\\s*"name":\\s*"' + escapeRe(brand) + '[^"]*"(?:(?!\\n  \\{)[\\s\\S])*?\\n  \\},?(?=\\r?\\n)',
      'g'
    );
    html = html.replace(re, '');
  }
  // Removing the last element can leave "},\n]" — legal in a JS array
  // literal, so no further clean-up is needed.

  return new Response(html, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
