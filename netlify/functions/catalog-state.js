/**
 * Catalog state sync via GitHub
 * POST: triggers GitHub repository_dispatch to update index.html
 * GET:  returns current state from kvdb (fallback read)
 */

const ADMIN_SECRET   = process.env.CATALOG_ADMIN_SECRET || 'seid_catalog_2024';
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_OWNER   = process.env.GITHUB_OWNER;   // your github username
const GITHUB_REPO    = process.env.GITHUB_REPO || 'seidkarlinn-heildsala';
const KVDB_BUCKET    = process.env.KVDB_BUCKET || '';
const KVDB_KEY       = 'seidkarlinn_catalog';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const EMPTY = { deleted: [], custom: [], pricing: {}, productInfo: {}, accounts: {}, updatedAt: null };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  // ── GET — read from kvdb ──────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (!KVDB_BUCKET) return { statusCode: 200, headers: HEADERS, body: JSON.stringify(EMPTY) };
    try {
      const res = await fetch(`https://kvdb.io/${KVDB_BUCKET}/${KVDB_KEY}`);
      if (!res.ok || res.status === 404) return { statusCode: 200, headers: HEADERS, body: JSON.stringify(EMPTY) };
      const text = await res.text();
      return { statusCode: 200, headers: HEADERS, body: text || JSON.stringify(EMPTY) };
    } catch {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(EMPTY) };
    }
  }

  // ── POST — save to kvdb AND trigger GitHub Action ─────────────────────────
  if (event.httpMethod === 'POST') {
    if (event.headers['x-admin-secret'] !== ADMIN_SECRET) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    try {
      const body = JSON.parse(event.body || '{}');
      const state = {
        deleted:     body.deleted     || [],
        custom:      body.custom      || [],
        pricing:     body.pricing     || {},
        productInfo: body.productInfo || {},
        accounts:    body.accounts    || {},
        updatedAt:   new Date().toISOString(),
      };

      const results = {};

      // 1. Save to kvdb
      if (KVDB_BUCKET) {
        try {
          const kvRes = await fetch(`https://kvdb.io/${KVDB_BUCKET}/${KVDB_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state),
          });
          results.kvdb = kvRes.ok ? 'ok' : `error ${kvRes.status}`;
        } catch (e) {
          results.kvdb = 'failed: ' + e.message;
        }
      }

      // 2. Trigger GitHub Action to bake deleted list into index.html
      if (GITHUB_TOKEN && GITHUB_OWNER) {
        try {
          const ghRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                event_type: 'catalog-update',
                client_payload: { state },
              }),
            }
          );
          results.github = ghRes.status === 204 ? 'ok' : `error ${ghRes.status}: ${await ghRes.text()}`;
        } catch (e) {
          results.github = 'failed: ' + e.message;
        }
      } else {
        results.github = 'skipped (GITHUB_TOKEN or GITHUB_OWNER not set)';
      }

      const success = results.kvdb === 'ok' || results.github === 'ok';
      return {
        statusCode: success ? 200 : 502,
        headers: HEADERS,
        body: JSON.stringify({ success, results, updatedAt: state.updatedAt }),
      };

    } catch (err) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
};
