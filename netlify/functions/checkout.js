/**
 * Seiðkarlinn Heildsala — Teya Checkout Function
 * Fixed per Teya support (Eva Halldórsdóttir):
 * - scope=checkout/sessions/create required in token request
 * - amount must be {value, currency} object
 * - type: "SALE" required
 * - Idempotency-Key header required
 */

const TEYA_AUTH_URL = 'https://id.teya.com/oauth/v2/oauth-token';
const TEYA_API      = 'https://api.teya.com';

const CLIENT_ID     = process.env.TEYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TEYA_CLIENT_SECRET;
const CONTRACT_ID   = process.env.TEYA_CONTRACT_ID;
const SITE_URL      = process.env.SITE_URL;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  if (!CLIENT_ID || !CLIENT_SECRET || !CONTRACT_ID || !SITE_URL) {
    console.error('Missing env vars:', { CLIENT_ID: !!CLIENT_ID, CLIENT_SECRET: !!CLIENT_SECRET, CONTRACT_ID: !!CONTRACT_ID, SITE_URL: !!SITE_URL });
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error — env vars missing. Trigger a redeploy after adding them in Netlify.' }) };
  }

  try {
    // 1. Parse cart
    const body = JSON.parse(event.body || '{}');
    const { cart, buyerName, buyerEmail, orderNote, buyerUsername } = body;
    if (!cart || !Array.isArray(cart) || !cart.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Karfan er tóm' }) };
    }

    // 2. Get OAuth token — scope=checkout/sessions/create is required
    console.log('Requesting Teya token with scope...');
    const tokenRes = await fetch(TEYA_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'checkout/sessions/create refunds/create',
      }),
    });

    const tokenText = await tokenRes.text();
    console.log('Token status:', tokenRes.status, '| body:', tokenText.substring(0, 300));

    if (!tokenRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Teya auth failed (${tokenRes.status}): ${tokenText}` }) };
    }

    const { access_token } = JSON.parse(tokenText);
    if (!access_token) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No access_token in Teya response: ' + tokenText }) };
    }

    // 3. Build totals at wholesale price (75% of retail)
    const parseISK = (s) => parseInt((s || '').replace(/[^\d]/g, '')) || 0;

    const items = cart.map((item) => {
      const unit = parseISK(item.wholesale) || Math.round(parseISK(item.price) * 0.75);
      return {
        name:     item.name.substring(0, 80),
        quantity: item.qty,
        amount: {
          value:    unit * item.qty,
          currency: 'ISK',
        },
      };
    });

    const total = items.reduce((s, i) => s + i.amount.value, 0);

    if (total < 50000) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: `Lágmark 50.000 ISK. Núverandi: ${total.toLocaleString('is-IS')} ISK` }),
      };
    }

    const orderId = ('WS' + Date.now().toString(36).toUpperCase()).slice(-12);

    // Unique idempotency key per request
    const idempotencyKey = `${orderId}-${Date.now()}`;

    // 4. Create Teya checkout session — correct payload per Teya docs
    const payload = {
      type:               'SALE',
      store_id:           CONTRACT_ID,
      merchant_reference: orderId,
      amount: {
        value:    total,
        currency: 'ISK',
      },
      success_url:           `${SITE_URL}/success.html?order=${orderId}`,
      cancel_url:            `${SITE_URL}/cancel.html`,
      post_success_payment:  'SHOW_SUCCESS_PAGE',
      ...(buyerName || buyerEmail ? {
        customer: {
          ...(buyerName  && { name:  buyerName }),
          ...(buyerEmail && { email: buyerEmail }),
        },
      } : {}),
    };

    console.log('Creating session, total:', total, 'ISK, orderId:', orderId);

    const sessionRes = await fetch(`${TEYA_API}/v2/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Authorization':   `Bearer ${access_token}`,
        'Content-Type':    'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const sessionText = await sessionRes.text();
    console.log('Session status:', sessionRes.status, '| body:', sessionText.substring(0, 500));

    if (!sessionRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Teya session failed (${sessionRes.status}): ${sessionText}` }) };
    }

    const session = JSON.parse(sessionText);
    const checkoutUrl = session.session_url || session.checkout_url || session.payment_url || session.url || session.redirect_url;

    if (!checkoutUrl) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No checkout URL in Teya response: ' + sessionText.substring(0, 400) }) };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        checkout_url: checkoutUrl,
        order_id:     orderId,
        session_id:   session.session_id || null,
        total,
      }),
    };

  } catch (err) {
    console.error('Function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Innri villa: ' + err.message }) };
  }
};
