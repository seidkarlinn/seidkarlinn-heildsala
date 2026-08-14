/**
 * Netlify Edge Function — serves favicon files inline from base64 strings.
 *
 * Why this lives in an edge function rather than as binary files in the repo:
 * the GitHub MCP wrapper used to commit these changes round-trips binary content
 * through UTF-8 text encoding, which corrupts non-text bytes. To deliver real
 * binary favicons without that loss, we inline the base64 here and the edge
 * function decodes + returns the raw bytes with proper Content-Type. Browsers
 * can fetch /favicon.ico, /favicon-32.png, /favicon-180.png as normal URLs.
 *
 * 2026-05-13: All three favicon sizes use the "S" monogram (boxed serif S
 *   matching the wordmark frame). Previously the 32px and 180px variants used
 *   the full SEIÐKARLINN wordmark fit-to-square; switched to the S monogram
 *   per user request for visual consistency across sizes.
 *
 * 2026-08-14: Replaced the "S" monogram with the Seiðkarlinn wizard mark, so
 *   the wholesale site matches the favicon now set on the retail store
 *   (seidkarlinn.is). Source art is the worn-stamp wizard illustration,
 *   reworked for small sizes: solid near-black ink (the original brown-grey
 *   at ~75% alpha was too faint in a tab), fine interior speckle removed and
 *   remaining shapes thickened, plus a cream keyline around the silhouette.
 *   The keyline is what lets one transparent icon work on both light and dark
 *   tab bars — on white the black body reads, on dark the cream rim traces
 *   the outline. PNGs are palette-quantised (8 colours at 16/32px, 4 at
 *   180px) to keep the inlined base64 small.
 *
 *   NOTE: the <link> hrefs injected by inject-catalog.js carry a
 *   ?v=FAVICON_VERSION cache-buster. Bump FAVICON_VERSION there (currently
 *   '2') whenever these bytes change, so already-cached icons refetch
 *   immediately rather than waiting for the max-age below to lapse.
 */

const FAVICONS = {
  "/favicon.ico":     { type: "image/x-icon", b64: "AAABAAEAEBAAAAEAIAD0AAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAQDAAAA7d3iUgAAABhQTFRFAQAAHhsZXlpVoZ2V/Pv58e3ha2tqW1ZS2eB0kwAAAAh0Uk5TAPr0+Ar+DJ+dTAjCAAAAg0lEQVR42gXBIRKCQBSA4X/fW10MzLgWqozFaFObwRMYDQ438EoehMRJNNqWoAO4C36fAi4fEwLz3g2gYKbZYf0E2JSAYu9vF2MSKkMbAU6q6qkMdrpQaxBiDqjI2Qgjw1Vq35LgoWTbJqPrlEVw4fjaY0u/NB705j6/oi++WDCrXcUfqM0jsCyr+qMAAAAASUVORK5CYII=" },
  "/favicon-32.png":  { type: "image/png",    b64: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAGFBMVEUAAAAWExHx7OFhXlijn5b9/Pt5eXmempK3xZdWAAAACHRSTlMA/v729Q4CnBvjuMMAAAF0SURBVHjaVZC9bhNREIW/+7cmimLdwRUN3pggUUSO1w7QgGSUJgqNpUhQULAlb8Br8AhQpKejwgUNlBaicBpkUQUk4xsRhdhr71J47YhTjUbfnDk6sNTzWjloABy/8v8W2cFN7jvWcq5rxEfXRJbxGHMEgAJIg+nD5Jo4CbcnQLomsFVfhJ1BBhigd68iw72fF4d3h+WXRLq1tki08ki7Wo+lzgzAApdB9Q/yb1sP67P3ZS67k9i2yOok683nsjcItErPtGIbjUYjkdqzJXEybwKMWMzAQqSaBZCDipdJj/umCnoMRUCBm3tTBfUb9BhL6t+ti8lBgWB2f0ARgAkadL35KV5VioGr6catq2nsz4BXXwwIf77/3VxM71RC4YcWYOGL+sLmASIMFQdsn96YfW6dxR9RuN0RxCM0Oe0tr3nxFRict/IcM47eKiAZgRSBotN+kwEprztJR0T2Pb0yTe+JSM12nStLTj+YBy/PH/nsKfwDDYFuMun0R+AAAAAASUVORK5CYII=" },
  "/favicon-180.png": { type: "image/png",    b64: "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" },
};

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default async function handler(request, _context) {
  const url = new URL(request.url);
  const f = FAVICONS[url.pathname];
  if (!f) {
    // Shouldn't happen given the config.path matcher, but be defensive.
    return new Response("Not Found", { status: 404 });
  }
  return new Response(b64ToBytes(f.b64), {
    status: 200,
    headers: {
      "content-type": f.type,
      "cache-control": "public, max-age=3600, must-revalidate",
    },
  });
}

export const config = {
  path: ["/favicon.ico", "/favicon-32.png", "/favicon-180.png"],
};
