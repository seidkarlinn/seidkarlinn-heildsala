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
 * Added 2026-05-13 alongside inject-catalog.js favicon <link> injection.
 */

const FAVICONS = {
  "/favicon.ico":     { type: "image/x-icon", b64: "AAABAAEAEBAAAAAAIABOAQAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAARVJREFUeJyl0yFLBFEUBeBvZhZMioJYFLWLIBj8FVaDdqNgErRpMhoMFv+ATRCbZScYDILgT9Aighi0zIxh3sLb2bdlvXBh5rxz7z1n7psMX3gxWaxDf8Ji6OfIEgfFGKyLZ70EMUMVnpdD0Tt+UxK6DXLUOMB+hBV4wg1u0YQcalCEybs4wV4oglWcYTEMGHBB2VFzhbuU3ESUsYJa6/8C93jGG37wrd3WdcQfsTBo8Io1bGMJM5jFKba03yZpIY/8ziXkbuDT8NrLPHrJQp7jETtYwQI2cRmsNaL7EFuogorjIP8I08FajgcchiF1LK00Pua1q5sac16mbmIessJHhBdhchOTe10gkGqjUSWwJvPP3/kPXnw7anVmncUAAAAASUVORK5CYII=" },
  "/favicon-32.png":  { type: "image/png",    b64: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABDUlEQVR4nO3SuUoDQBSF4S+LiSHuG0YEsbESRFALfQxf3NJGBQsVBUWjiSSa2JxAGmsL54dhtruce2coFAqFQuGPqWAPd1jBe85nMUIfNbRyN8qYie/3VJw2vtBDPXfVjGFs6hhn38BmFbeYj0MfC1l/JPlSHFoJVo+AF6znrpeAY6zhE92InUuR3Yg4Sp4B7icBv+K8ik4SdbGBs4jp4RDnsa3gGAdYjJiddKSZuR1hbzjBMq6xj11UKqmsFuNmBD1HVCPdec/5EK+pags38e/gcirGCp6mhDzkrIOrdOgUF5M/8JgqnpOo5fc/UM08my7Vsh4kWWPqmfp5znEKmvydYeJsKxQKhULh3/MDd31Dlxo18L4AAAAASUVORK5CYII=" },
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
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}

export const config = {
  path: ["/favicon.ico", "/favicon-32.png", "/favicon-180.png"],
};
