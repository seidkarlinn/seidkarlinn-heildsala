/**
 * Scheduled sweep (every 10 min, see netlify.toml): asks Teya about every
 * card order that is still awaiting payment, so declined / abandoned
 * checkouts are marked "payment_failed" even if nobody opens Pantanir and the
 * buyer never returns to success.html / cancel.html. Paid ones are confirmed
 * and the order e-mail goes out.
 * Scheduled functions cannot be called by URL, so the logic lives in
 * teya-verify.js (no order param = sweep) and this file only triggers it.
 */
const verify = require("./teya-verify");

exports.handler = async () => {
  const res = await verify.handler({ httpMethod: "GET", queryStringParameters: {} });
  console.log("[teya-sweep]", res.statusCode, String(res.body).slice(0, 500));
  return { statusCode: 200 };
};
