/**
 * Seiðkarlinn Heildsala — Teya Refund Function
 * POST { sessionId, amount, reason, orderId }
 * Uses Teya /v2/refunds endpoint
 */

const TEYA_AUTH_URL = 'https://id.teya.com/oauth/v2/oauth-token';
const TEYA_API      = 'https://api.teya.com';

const CLIENT_ID     = process.env.TEYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TEYA_CLIENT_SECRET;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Env vars missing' }) };
  }

  try {
    const { sessionId, amount, reason, orderId } = JSON.parse(event.body || '{}');

    if (!sessionId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'sessionId vantar — Teya session ID er nauðsynlegt fyrir endurgreiðslu' }) };
    }
    if (!amount || amount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Upphæð verður að vera stærri en 0' }) };
    }

    // 1. Get OAuth token with refunds/create scope
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
    if (!tokenRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Teya auth failed: ${tokenText}` }) };
    }
    const { access_token } = JSON.parse(tokenText);

    // 2. Create refund
    const idempotencyKey = `refund-${orderId}-${Date.now()}`;
    const refundPayload = {
      session_id:         sessionId,
      amount: {
        value:    Math.round(amount),
        currency: 'ISK',
      },
      merchant_reference: `REFUND-${orderId}`,
      ...(reason && { reason }),
    };

    console.log('Creating refund for session:', sessionId, 'amount:', amount);

    const refundRes = await fetch(`${TEYA_API}/v2/refunds`, {
      method: 'POST',
      headers: {
        'Authorization':   `Bearer ${access_token}`,
        'Content-Type':    'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(refundPayload),
    });

    const refundText = await refundRes.text();
    console.log('Refund status:', refundRes.status, '| body:', refundText.substring(0, 300));

    if (!refundRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Teya refund failed (${refundRes.status}): ${refundText}` }) };
    }

    const refund = JSON.parse(refundText);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success:  true,
        refundId: refund.id || refund.refund_id || 'OK',
        amount,
      }),
    };

  } catch (err) {
    console.error('Refund function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Innri villa: ' + err.message }) };
  }
};
