// Netlify Function: oos-data
// Fetches Out-of-Stock products, low stock, and top sellers from Shopify Admin API
// Powers the Birgðasagan local dashboard (seidkarlinn-birgdasagan.html)
//
// REQUIRED ENVIRONMENT VARIABLES (set in Netlify UI -> Site settings -> Environment variables):
//   SHOPIFY_STORE_DOMAIN  e.g. seidkarlinn.myshopify.com
//   SHOPIFY_ADMIN_TOKEN   Admin API access token (shpat_...)
//   ALLOWED_ORIGIN        e.g. * for local file://, or https://yourdomain.is for production

const SHOPIFY_API_VERSION = '2024-10';

exports.handler = async (event) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!storeDomain || !adminToken) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars' }),
    };
  }

  const endpoint = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const shopifyFetch = async (query, variables = {}) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  };

  try {
    // ---------- 1) OUT OF STOCK PRODUCTS ----------
    const oosQuery = `
      query OOS($cursor: String) {
        products(first: 100, after: $cursor, query: "inventory_total:0 status:active") {
          edges {
            cursor
            node {
              id
              title
              handle
              vendor
              productType
              tags
              totalInventory
              updatedAt
              featuredMedia { preview { image { url } } }
              priceRangeV2 { minVariantPrice { amount currencyCode } }
              variants(first: 1) {
                edges { node { id sku price inventoryQuantity } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const oos = [];
    let cursor = null;
    let hasNext = true;
    while (hasNext) {
      const data = await shopifyFetch(oosQuery, { cursor });
      data.products.edges.forEach((e) => oos.push(e.node));
      hasNext = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
      if (oos.length > 500) break; // safety
    }

    // ---------- 2) LOW STOCK PRODUCTS (1-5) ----------
    const lowQuery = `
      query Low($cursor: String) {
        products(first: 100, after: $cursor, query: "inventory_total:>0 inventory_total:<=5 status:active") {
          edges {
            cursor
            node {
              id
              title
              handle
              vendor
              totalInventory
              featuredMedia { preview { image { url } } }
              priceRangeV2 { minVariantPrice { amount currencyCode } }
              variants(first: 1) {
                edges { node { sku price inventoryQuantity } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const low = [];
    cursor = null;
    hasNext = true;
    while (hasNext) {
      const data = await shopifyFetch(lowQuery, { cursor });
      data.products.edges.forEach((e) => low.push(e.node));
      hasNext = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
      if (low.length > 500) break;
    }

    // ---------- 3) TOP SELLERS (last 30 days, by orders containing the product) ----------
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceISO = since.toISOString();

    const ordersQuery = `
      query Orders($cursor: String, $q: String!) {
        orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            cursor
            node {
              id
              createdAt
              displayFinancialStatus
              lineItems(first: 50) {
                edges {
                  node {
                    title
                    quantity
                    originalTotalSet { shopMoney { amount currencyCode } }
                    product { id handle featuredMedia { preview { image { url } } } }
                    variant { sku price }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const productAgg = new Map();
    cursor = null;
    hasNext = true;
    let orderCount = 0;
    const maxOrders = 500;
    while (hasNext && orderCount < maxOrders) {
      const data = await shopifyFetch(ordersQuery, {
        cursor,
        q: `created_at:>=${sinceISO} financial_status:paid`,
      });
      data.orders.edges.forEach((e) => {
        orderCount++;
        e.node.lineItems.edges.forEach((li) => {
          const n = li.node;
          if (!n.product) return;
          const key = n.product.id;
          const existing = productAgg.get(key) || {
            productId: n.product.id,
            handle: n.product.handle,
            title: n.title,
            image: n.product.featuredMedia?.preview?.image?.url || null,
            unitsSold: 0,
            revenue: 0,
            currency: n.originalTotalSet?.shopMoney?.currencyCode || 'ISK',
          };
          existing.unitsSold += n.quantity;
          existing.revenue += parseFloat(n.originalTotalSet?.shopMoney?.amount || '0');
          productAgg.set(key, existing);
        });
      });
      hasNext = data.orders.pageInfo.hasNextPage;
      cursor = data.orders.pageInfo.endCursor;
    }

    const topSellers = [...productAgg.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 25);

    // ---------- 4) Cross-reference: which OOS products were top sellers (revenue lost signal) ----------
    const oosIds = new Set(oos.map((p) => p.id));
    const oosThatSold = topSellers.filter((p) => oosIds.has(p.productId));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        windowDays: 30,
        ordersScanned: orderCount,
        outOfStock: oos,
        lowStock: low.sort((a, b) => a.totalInventory - b.totalInventory),
        topSellers,
        oosRevenueLossSignal: oosThatSold,
        summary: {
          oosCount: oos.length,
          lowCount: low.length,
          topSellersCount: topSellers.length,
          oosThatRecentlySold: oosThatSold.length,
          totalOosValueAtListPrice: oos.reduce(
            (sum, p) => sum + parseFloat(p.priceRangeV2?.minVariantPrice?.amount || '0'),
            0
          ),
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
