/**
 * Netlify Edge Function — product-image URL repair (2026-09-04)
 *
 * A batch of Shopify product photos was re-uploaded, which changes their CDN
 * path: every old URL now 404s and the affected products render as blank
 * cream tiles in the wholesale catalog (36 products — the Nutriest organ /
 * doypack line, the Seiðkarlinn oils and tinctures, whey, collagen,
 * strawberries, propolis).
 *
 * Rather than editing the ~500KB index.html for a string swap, this function
 * runs as the OUTERMOST edge wrapper (declared first in netlify.toml) and
 * rewrites the stale URLs in the served HTML — so it also covers products
 * injected by inject-catalog.js. Plain string replacement, no parsing.
 *
 * Maintenance: when a photo is re-uploaded on Shopify again, add the
 * old → new pair here. To retire a pair (once nothing references the old
 * URL), just delete its line. Idempotent by construction: a URL that is
 * already the new one simply doesn't match.
 */

const IMG_URL_FIXES = {
  // Seiðkarlinn tinctures / oils
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/propolistinkt.jpg?v=1782339016':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-propolis-tincture-30ml.jpg?v=1786746166',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn_13.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-oregano-olia-30ml.jpg?v=1786746747',
  'https://www.seidkarlinn.is/cdn/shop/files/370.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-parasite-cleanse-tinktura.jpg?v=1786746748',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn_7.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-rosmarin-olia-30ml.jpg?v=1786746748',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn_6621c6f3-b6f2-455a-99d2-2b3cae317c11.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-skegg-olia-30ml.jpg?v=1786746747',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/350_8352f786-c655-4d83-b42d-116e5aa1e0f5.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-blue-lotus-hemp-stem-tincture-30ml.jpg?v=1786746166',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn_8.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-fire-cider-tonik.jpg?v=1786746748',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn_3_4f0dd1e1-e549-40f9-871b-5d2dfe430096.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-willow-bark-tinktura.jpg?v=1786746748',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn_2_e939a8a3-e81d-4ad5-8075-9df7ea3be72b.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/seidkarlinn-cayanne-olia-30ml.jpg?v=1786746747',

  // Freeze-dried fruit
  'https://www.seidkarlinn.is/cdn/shop/files/292.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/f20977.jpg?v=1782388697',

  // Nutriest
  'https://www.seidkarlinn.is/cdn/shop/files/varia_6.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-whey-protein-1kg-v2.jpg?v=1788381320',
  'https://www.seidkarlinn.is/cdn/shop/files/IMG-3975.jpg':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-bone-broth-250g.jpg?v=1788380848',
  'https://www.seidkarlinn.is/cdn/shop/files/varia_7.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-hydrolyzed-collagen-peptides-300g.jpg?v=1788380849',
  'https://www.seidkarlinn.is/cdn/shop/files/256.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-marine-collagen-300g.jpg?v=1788380882',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn-3_13d6e004-ebf5-4bee-bbc7-6495e4b2abc7.jpg':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-liver-240hylki.jpg?v=1788380848',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn-4_6df8979d-c92b-41a5-9916-45ee4f98395c.jpg':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-testicles-240hylki.jpg?v=1788380849',
  'https://www.seidkarlinn.is/cdn/shop/files/248.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-organ-complex-240-hylki.jpg?v=1788380880',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn-3_9f26cb56-fa9f-4e72-a282-a8bb73b62041.jpg':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-ultimate-organ-complex-240hylki.jpg?v=1788380849',
  'https://www.seidkarlinn.is/cdn/shop/files/250.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-pancreas-240-hylki.jpg?v=1788380880',
  'https://www.seidkarlinn.is/cdn/shop/files/252.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-colostrum-extract-240-hylki.jpg?v=1788380881',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn_2_23bad7cb-0fb2-4781-8f60-f97b9eb70b48.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-ox-bile-60-hylki.jpg?v=1788380883',
  'https://www.seidkarlinn.is/cdn/shop/files/258.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-advanced-probiotic-60-hylki.jpg?v=1788380881',
  'https://www.seidkarlinn.is/cdn/shop/files/259.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-deep-ocean-minerals-100ml.jpg?v=1788380881',
  'https://www.seidkarlinn.is/cdn/shop/files/Seidkarlinn_0fbe134e-17a6-4e33-829e-192ee6ff64db.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-pregnancy-and-fertility-240hylki.jpg?v=1788380851',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/257.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-kidney-doypack-135g.jpg?v=1788380882',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/255.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-heart-doypack-135g.jpg?v=1788380882',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/254.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-blood-180-hylki.jpg?v=1788380882',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/251.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-lung-240-hylki.jpg?v=1788380881',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/249_05e783c6-7897-4163-913d-9e029a97d514.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-thyroid-240-hylki.jpg?v=1788380880',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn_2_545b5ec1-b4e5-4132-a42e-eec18f67f6a0.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-liver-135g-doypack.jpg?v=1788380879',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn_1_1711d134-7371-4744-8c58-edf277f5a727.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-organ-complex-135g-doypack.jpg?v=1788380851',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/245.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-kidney-240hylki.jpg?v=1788380851',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/244.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-brain-240hylki.jpg?v=1788380850',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/246.png':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-heart-240hylki.jpg?v=1788380851',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn-3_336426b1-0eaf-46e2-870b-3760acc5f380.jpg':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-pure-oyster-extract-120hylki.jpg?v=1788380849',
  'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Seidkarlinn-3_9503e92c-f2f4-4765-b3a6-05635b3c4429.jpg':
    'https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nutriest-beef-spleen-240hylki.jpg?v=1788380848',
};

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  for (const [oldUrl, newUrl] of Object.entries(IMG_URL_FIXES)) {
    if (html.includes(oldUrl)) html = html.split(oldUrl).join(newUrl);
  }

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
