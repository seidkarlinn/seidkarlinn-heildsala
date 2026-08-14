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
 *
 * 2026-08-14 (v6): Replaced all three sizes with the new wizard favicon art
 *   supplied by the user (seidkarlinnfaviconv6.png, 1024px source): cream
 *   fill with solid black ink and keyline, transparent background. Resized
 *   with Lanczos and palette-quantised (16 colours at 16/32px, 8 at 180px)
 *   to keep the inlined base64 small. FAVICON_VERSION in inject-catalog.js
 *   bumped 2 -> 3 to bust cached icons.
 */

const FAVICONS = {
  "/favicon.ico":     { type: "image/x-icon", b64: "AAABAAEAEBAAAAEAIAAkAQAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAQDAAAA7d3iUgAAADBQTFRFAQAAHhsZXlpVoZ2V/Pv58e3ha2tqW1ZSb2xlgn12iIR8m5qMopyWn5uSKSYkh4N8I+mQwgAAABB0Uk5TAPr0+Ar+DJ9s+PglVptYnIuMDeQAAACTSURBVHjaBcGtDcJQFIDR77770p+EkhSHbBA4NALxBBMgUS84BsB3BcIEbEBQJFSwAbaBAQgKWtU0tOEcBcKk7zAQlGELBvq6dQ4gmWQ5KHb7DotfZ/BCZQGc6iHNvWA/Gwr9GqIpoMYsdw097VoGwf5sL9w1knJ1pZlLFCO42wybpWNJ45P416MeVuMnFo6jhecPL5slX6tff3EAAAAASUVORK5CYII=" },
  "/favicon-32.png":  { type: "image/png",    b64: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAMFBMVEUAAAAWExHx7OFhXlijn5b9/Pt5eXmempKtra2Ig33j39WtqKBuamVAPTlFQT3KxbsVRgf1AAAAEHRSTlMA/v729Q4CnAP5XXGw/fz/O98UXwAAAZxJREFUeNpFkD9oE2EYxn/ffblrMKncZy0OQnopoggZ0sQ6OGjqIhqQA7FZRA5HBenmmkVwFFqoo4KZPQRxK+mkQhvEoVBB/Iqi1hJzJVAv/+4ccrbP9j68zx8eyRi1X6vFJod47C+o5JQArO2pr5t7EYABYJppnx+CQ0JacZXwxpHkzmlrnXip2Pz/0QhyG+Dpo5SXJ2bzat4EEICb2RLN2nvrSt8fS/wtfSq/S98rJh5exeh9UQV+1xPiYFfUbkXvWF10x5am+f3M3EpJqef1JOT2h/NXy8aOupROPO4NerrjuGzfHBON7EMATaZfR4JltAhhcp9+5QkSRm6rOwHDv/B5MEyBeXkNIAZ6z7TAyy0jj4P4A3QQ6VAh57chDoAOqTBrFOT1XrubdDKg9Sl4EXQdB2AJAQrZzpnT4VRbZ8vFFMDIjmYyB1FAbNUNJgBOfvwW+A6514j0qKDB0RhElCZtObz74BX4+eBnjFR2Q8CxcxpUHJA9W3o6ADwelefKSqkLNslkuAtKTaUqb8xkIO+tvHh//5pdrcI/hWaFssNHHNwAAAAASUVORK5CYII=" },
  "/favicon-180.png": { type: "image/png",    b64: "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0BAMAAADP4xsBAAAAGFBMVEUAAAATEA718OX5+PRiXlmmopr28ebz7uN6oHBcAAAACHRSTlMA/v0N/v6eXIbGWFYAAA6PSURBVHjarVtdbxvXmX5m3pElxSY9lNzUtmSJsd2sg4jiEcex6yJ2qcS7QAskVS6KoijaXARFL7rd7LZA9lcEG2DRi14UaC961aBRdxeLAmvHgwpYpEBoHZlpYreWRMlO9WFSHEpbfZQ8c/aC5HA4nBkOLfGKnI+H73m/3+fMKIj8MaQFUDGhLEa7Xo0Ojax6flLCIoNFulyLLDOEVSoBkLUUj3SHEhGZBPpHyvVbvvBQRLolyjXSWJPG9y4sHdR/9o2dXj86qUkbAcYbiqj803tHpBAymPh5ZmfU0XBlTOdHA81e+U3/CTluOgfkcEEckfNZz1XLzHJ5lcaOxoy0aT16ZlynC0uO1M98Jo9Gak2t1Tju5k45stZS7GhCRgqVVRIJ7ckjR/tj5pFILWpgpilyf/jcMfmsdUQekhn/rxNTlZwh/lps3hSP4n2RPGQcEMi5bZ8/IuejRZgwjBZcldgRQS9lZRK53Nuy5dj8SDyENPDt4fy/4tfLetOyVSb4EYSMupnYPXPj00ef2i2TXxv73VFEY/pbn1b7tzf1rYPWsZWt0hHommg2WVM4hFsKtUpHAC3yxDMiBe1mPNs6WIgQ6l2h2T/WUJihCZFzO3M2ewS6Lv8lWezfzK3tvvX8gz3n6EZmef2wUtOLNk8pnN4Z+fVsynW8dHip08qlR3uv7337NzRWKLhSz+af5GHTE1NPKo8XWdkJl0akxRJdg6Z7oFPhK+wTakdGrZA6fFLNWNqfmLrt1a2S6Fp6u+QQxvu+eRBDumx2RJI4tNQAcGy03HEsEQc/jNRMtRRdQN3yObUiDmVGsibB82St+JSe1KH8morxP/dtY/TA7jy3sfnZYczI5HaNkOJnfStEN0OGSr32tfhQJXnvu8sHnefsYxX59NB0bOv+g+998C+/Kwz4nL02+MX1pzejVHHxvSuzad23hUgdwq9JyuHhE2W1BODy8dlvopxri0c9dwjob5jPLo+WAUzXw4PSt1tLenZRPLWuVVT3jo/u7QNT9xtwa192MqvS/1y4skN1rdkVsCRArUy94HLNLkNeaA5h/2DhVhlQXHZsJe5uyla6DIs//o8SUEm6lumkVy0RruxQv4a8cndsHbjmGmSEEz52F2WrYTKLq0WVA3D7tWq5lP2UIWOk6MoTOtdJAjjfzLn8U0EbufybRXrIIS3MukgA1xJIhvZQaiDy1TfNTFEHVB2OFdVbBXfthZF/CujcO08+HL9dVwAB6vYFAOMN72jKas2FiR0AbVx5nyr1iLgHBVDExzuQHJiBy6yyFiZ2AHRuQm2OWwJVIA3UGAPwe+RdHmvN9a4QMp3IYFDhZCWagg381klRYXMvBRyNO5Fh7SsD9wGg8tEA2DIwsL/nlIYX/m59vVczaq6/YbiZBQhJ4C4AQHdE5SHNSFDZrTnINQC59sWRfhgyTnMlMB0QMBQQJYbqrscPA620vjALIG0p1lgKmWiVcqt3aCaaNwntcR4QMedU0W38Gb1XaCFmLjTlEqix5gIe1VGV5pqIm6zXUkDaSIN6mypQUQ41ZyZFlxYwzRudayibGKAQcTCz3JRHQgGwXa8NhSQguZNFpAgmWAOT6k/VlayTLxhUkQQmgCEOKEAjAaq1t3Lc6BX6YCW74GR9E4u4B9sEBAAUmnYUyTs/+Emu5yqT+mV2oXVVFoIp0Op/NuNE1Dz7nw/eol6h8+JXYMBs3dKnTmEuKWMLr9a9WW1q+M5W8s6Pem4WyNgqAQkA6bk4YFeg6MBqDJgqQLaCZXphsefuiS86SQiAypAFMGZ5c8+c9PeS0MZspv2fYALABYA3zNnIZOw67xW6xtFIFwqANCAvALDrtdElqDnbs0I02bCFEgMyJoCPt1mzETHd4yn1Cp1Ss450ar2EiTvJRvp3KUtSqkdoIfR5N/+hDANAvhEu3M267lCPUuf/2OfQIgCYcpkBtYLdUVAt+aNePWTCucoETRfE4iMAOrI1T72W7D+px4GjGN/Dgg5QCbS1D0DuU/l4/8D6hg5lz3Xl42PPrfUitQEIpzGdrPd9X72RFAyY8YRxjfn0IyGDdI6cBPdqpRGY9yBhDnWWRDOxGB2aEXjNzpo60Gw/6sss67aut4UjANWHelEC+c5RxCldNt1zTDsB2I15CdK1mFAZBEwkEenDspE9hE3ZB3v5nV3qDwLbb/u1svpZdA/hAIXkc+qgR6I2wXwOQK2KajR9QFZZVKnrMkwFr8rDswh2nUVtJyWQxSwCu4yaN49YEc2oKif2H1w9uLT+QI9mRmx0ELhqsFC6lfXWMLcLebkoLZpCDMYYMIeQTtrq0GAuEnQul7WgImwXzXtK1Lx13VfXxtcq9wuw4w8PAiPG7uDnro15JiY/aFq3jLV9KMe0XTUIWtv1Hlkp/TGCQjT1Fqv7bg2RP2rtn1l3aClgAWACfREjBoBIeqpYkPPZACwGuROUGTsP3fXs5ym+uXrE0mqAUtahxQKk7py9KN6es9WAcKg2TFyNrmzBdvJdFbJAUHz1GaZr4MPuumY/bHWqfT1Mbko7z+ADTZ/MdifrfcfcZJtGVB8OLq3W21BhobfP3ba+shNaUFG08kS1F2ilZlBIoJP65lLFFZj+ka7u+k+E664HXjzmICZUa5y7ndU/oir+cieU1v6VR+r0fPlY+iO3eP5S054/9N5gi2dt17WRf2eEzLAS2E3bSAX5549naZS3R6+/roN2SV07em3Q7FhxNeZNDD3pGnRy0U/Xxqea6s1oQbVgPygBbEgfv6bcd6gUUafB3E3WT9dkFMc762wiQgfsn23dHvKyyiPKZ/dIxqXgodglC6LbtB6h8962Y2glKlvYBZq97SHWCHgc7dG5Lh04neXLnsUPQJ7YVfp9CbVgxP0OaLmVsD3OD0AO7A22jsiubu0+5SiEvdhKFzL9VYZJrBYAxQCWG6PSw6fUdYsW3Lk8tHrvMQoQcQBLrUZ4phABcMfPQ+qaltMztxtNQlKp759bpi9h1C0aVU9bS9v3bicbnqtAYQDA9ehxHlwbKX6+pAHAOQ3AMD50W5oH9u3doLMAblAJ1+k8I14CYDOFuSqvjBI+pk/ZPVPYh1aeLMjK2PzKlcI1C8D/7S4PQh7IQU8qC7YnnS53Oh8YcJ1M9KkczIQJ2EmRVQC1o4UKidCar/NZ0PhDQJwD7gA6sDKPT2C5jUZJqOEFUw3wEJHWAclBdRLuInZEVrqXL/NIhTsIi/lA24Bs2EBwwATEqdoWsOPqiEQVs+FW1Fs5rgW94GkNoTIxrJio3So5BZP1IRsekq7tJTW4+onfw852RIiph7k19eW78yEfQkntYN4TKwI6NePWMMJJgUBoJYmVie3P2y+yAMj6T4ovLSVejeR8nbQn8FicaEwpbcnjHABsAcDdYc9N29dFBOhaEqJ551zneF7P4bbHD90bVyHs5PwFZruXmS6Aw27EYjPol9t7APfGVRhd+/GdbZciyubQVmPD2MgiC2QAtLY6AAB9fXnuA50Om2lnQYBQABWKlEtc47BvM6D9oQOkasxPIaFty7BrUBQqlBhQqeu8LdEWXhN+0KGPc9SSTrMnkg3WQXbMpqSZ3A86fNaan7SAtJEHVM4B2Ba2OxZrtz0+2Eo9Z8Or0vLpzTOVsry0LqEMAKygfbG+WNdUM/081n0bQ0sPL3VJAHhcX6lqkg/lwBPROFVP+VbGDGPy/HgRgBijEm44/W1LzHZCpGW8TNlfIxTbebnSUXCnGrmViq5jK4v+7WRxyH+CpSuFSuWS5/EBranhMdeJgzf+dnbNTyFCBJKFdKFjJY2y7p4jJD4ol/xCRqSy/gqpmlT82KOQSQCZeLumkYH9iPJ+zjdyacD/oYnByY7jD3Ssfq4MAvfdsz/Y5jPjaz7Qawfrvl1zn935dkz/4GoMqL4Qd7txv/3A7j/Wulh1kTf+WYT59GPK+RgAkXOfuQ4FbZsWLr8Wwre/EE4kJVrnOze4iXs3Q1wekgpozTXHAx6H9DaTULnnuS7X/74XPg6+ArESjF1ACiBOvtB8SmRDkKd4WIuqgEzA7uPcX9f6go9UVH+0ViuE9qg6JgDo11L+6Sm/kPVZsTzRcIAwUkeBbQJTWhDPJ1K/zC4HdVz1haosSOgVQCtc5zwgqeZTv1Itf4rTdjB87QDSQbG+nwdSiCL/wkxAVWdOafdbUgETkHFt0AgmmQXMi0G+1eyNfT5bIBMqvp7PhTC6hHEvk6OkuYvM8aHEocWwrGM68Yv2p0s9BUyIzpDUuxQ4GYOqAzzneW7VWxuZWW8s6CbgVi8LVkgGOAdIjfPwOe3JmYOBfUDqa8cbNUo5vQ9guT46rnbyWdoe0h8Br6ydXwsdpCGErljYUQqwGxyBXe9MCwBoKeanDjIB4jHRbbp8sjFTGTy5dmpgpiF338AeAAxUv1TYHez0O71RemP317pBS3nv+y8+v/HS5n9/6a/91wqAOrjb4B39TJhdR/ojAImX5bpvrLX9mQDo7dlpnrsyMVcEtFgwX4hpjtUY/F8XUfyYruarWDQOKmqxcR6CXOeEK891vtLh05gJkcszAGCpUzfFzpNAx6ZpDioRA00nYymgu9RtuslYyN7xb1DkdhJUpK0kgOlfiN6gYXAwTfq/9HV5EaCHw1sX3wBu5RjvERogARr3sSPd4AAV6QZ//T0ARi6EnQxogL+98YXRaxv9L3j2Vo3ddUAt0db+6/+eHtnM5NAz9OnEXOzg4vnxhScu/tN43ioDmPyM4vob/5bma3INTwF9Zql69X9XjWfLg/3XF75y9uyzqfFKeQMAjf3h8q72jXcZDy7y4QrJzI3y8nkA2SYXdlM5+T5olNMN3jfIjeCH9LtAG1RE5jbSQxy4KXi9JcvsjCzg8iL+/mcU9mpB13eTrr5o0sgC5EvH79VfnycmT86/tAjttXfBwpi/btBGjn7yPuzLtwE6qQNAjqkWoL32Lij8dYj/ByHWIGEVOSwGAAAAAElFTkSuQmCC" },
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
