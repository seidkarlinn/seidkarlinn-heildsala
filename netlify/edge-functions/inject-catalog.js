/**
 * Netlify Edge Function — runs at CDN level before HTML is served
 * Fetches catalog state from kvdb and injects deleted list into the HTML.
 * Also injects the CordyFresh product set into the PRODUCTS array
 * (added 2026-05-06; sourced from Shopify, applied at 30% wholesale discount).
 */

// 8 CordyFresh entries — Cordyceps/Lions Mane/Reishi/Chaga at 20% and 50% strengths.
// Retail prices match the Shopify store; wholesale = retail × 0.70 (30% off).
const CORDYFRESH = `
  {"name":"Cordyceps 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["cordyceps","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/cordyceps-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Cordyceps-20.jpg?v=1777761668","wholesale":"4.193 ISK"},
  {"name":"Lions Mane 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["lions mane","dropar","tvíextrakt","NGF","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/lions-mane-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Lions-Mane-20.jpg?v=1777761653","wholesale":"4.193 ISK"},
  {"name":"Reishi 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["reishi","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/reishi-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Reishi-20.jpg?v=1777761640","wholesale":"4.193 ISK"},
  {"name":"Chaga 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["chaga","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/chaga-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Chaga-20.jpg?v=1777761629","wholesale":"4.193 ISK"},
  {"name":"Cordyceps 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["cordyceps","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/cordyceps-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Cordyceps-50.jpg?v=1777761674","wholesale":"8.393 ISK"},
  {"name":"Lions Mane 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["lions mane","dropar","tvíextrakt","NGF","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/lions-mane-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Lions-Mane-50.jpg?v=1777761662","wholesale":"8.393 ISK"},
  {"name":"Reishi 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["reishi","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/reishi-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Reishi-50.jpg?v=1777761647","wholesale":"8.393 ISK"},
  {"name":"Chaga 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["chaga","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/chaga-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Chaga-50.jpg?v=1777761634","wholesale":"8.393 ISK"},`;

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) return response;

  const BUCKET = Deno.env.get('KVDB_BUCKET') || '';
  const KEY = 'seidkarlinn_catalog';

  let deletedJSON = '[]';

  if (BUCKET) {
    try {
      const kvRes = await fetch(`https://kvdb.io/${BUCKET}/${KEY}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (kvRes.ok) {
        const text = await kvRes.text();
        if (text && text !== 'null') {
          const state = JSON.parse(text);
          if (Array.isArray(state.deleted)) {
            deletedJSON = JSON.stringify(state.deleted);
          }
        }
      }
    } catch (e) {
      // Use empty deleted list if kvdb fails
    }
  }

  const html = await response.text();

  // 1. Inject the deleted list (existing behavior — runs before any scripts).
  let injected = html.replace(
    '<script>',
    `<script>window.__SERVER_DELETED__=${deletedJSON};window.__SERVER_CATALOG_READY__=true;</script>\n<script>`
  );

  // 2. Inject the CordyFresh entries at the start of the PRODUCTS array.
  //    Idempotent: only inject if the marker entry isn't already present
  //    (prevents double-injection if products are later baked into source).
  if (!injected.includes('"Cordyceps 20% Cordyfresh 30ml"')) {
    injected = injected.replace(
      'const PRODUCTS = [',
      `const PRODUCTS = [${CORDYFRESH}`
    );
  }

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
