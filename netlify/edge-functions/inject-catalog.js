/**
 * Netlify Edge Function — runs at CDN level before HTML is served
 * Fetches catalog state from kvdb and injects deleted list into the HTML
 * This guarantees every visitor gets the correct catalog on first load
 */
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

  // Inject the deleted list into the HTML before any scripts run
  const html = await response.text();
  const injected = html.replace(
    '<script>',
    `<script>window.__SERVER_DELETED__=${deletedJSON};window.__SERVER_CATALOG_READY__=true;</script>\n<script>`
  );

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
