// netlify/lib/regla.js — minimal SOAP client for the Regla web service
// ---------------------------------------------------------------------------
// Endpoint  https://regla.is/fibs/webservices2026/ReglaWebService.asmx
// Namespace http://www.regla.is/WebServices2026/
//
// AUTH
//   Login(username, password) -> MethodResult { Success, Messages[] }.
//   The session token comes back inside Messages as "<CODE>;<value>". We pick
//   the message whose code mentions TOKEN, and otherwise the first non-INFO
//   value that looks like a token. The token is cached per warm container and
//   renewed automatically when a call reports an invalid/expired token.
//
// ENV (Netlify, functions scope — never in the repo)
//   REGLA_USERNAME / REGLA_PASSWORD   web-service user created in Regla
//   REGLA_URL          optional endpoint override
//   REGLA_STOCKROOM_ID optional: only count stock in this stock room
//   REGLA_PRICE_BASIS  auto (default) | gross | net — whether Regla unit prices
//                      are with VSK (gross) or without (net). "auto" compares
//                      each product's Regla price with the portal retail price.
//   REGLA_DEFAULT_VAT  VSK % used only if Regla returns none for a product (11)
//
// XML ORDER MATTERS
//   The service is .NET XmlSerializer: elements inside a complex type must
//   appear in schema order, and anything out of order is silently dropped.
//   FIELD_ORDER below is copied from the WSDL for the types we send.

const URL_DEFAULT = 'https://regla.is/fibs/webservices2026/ReglaWebService.asmx';
const NS = 'http://www.regla.is/WebServices2026/';

const FIELD_ORDER = {
  Invoice: ['Customer', 'Concerning', 'Comment', 'InvoiceEntries', 'Amount', 'DiscountAmount', 'VatAmount',
    'Currency', 'ElectronicInvoiceOrderNumber', 'ElectronicInvoiceRequestor', 'Dimension1', 'Dimension2',
    'Dimension3', 'Dimension4', 'InvoiceNumber', 'AdditionalAttachments', 'EmailSubject', 'EmailBody',
    'PaymentPartitions', 'Date', 'CreditInvoiceNumber', 'DebetInvoiceNumber', 'Type', 'IsElectronicInvoice',
    'IsPrinted', 'UniqueReference', 'FiscalReceiptId', 'FiscalControlCode', 'FiscalTerminalId', 'Employee',
    'Location', 'ApplicationName', 'ApplicationVersion', 'NumberOfGuests', 'ParentUniqueReference', 'TypeName'],
  InvoiceEntry: ['Product', 'Quantity', 'Text', 'Amount', 'UnitPrice', 'VatPercentage', 'VatAmount', 'Discount',
    'IsDiscountPercentage', 'Dimension2', 'Dimension3', 'Dimension4', 'ID', 'Employee', 'Status', 'GUID', 'Date',
    'Barcode', 'LotNumber', 'ExpiryDate', 'SerialNumber', 'CurrencyCode', 'ParentGUID', 'Type', 'Priority',
    'SubInvoiceEntries', 'IsStockUpdated', 'StatusName', 'TypeName'],
  Customer: ['CustomerNumber', 'Name', 'AddressLine1', 'AddressLine2', 'PostalCode', 'City', 'Country', 'Phone1',
    'Phone2', 'Email', 'InvoiceEmail', 'PaymentMethod', 'InvoiceComment', 'CreditcardNumber',
    'CreditcardVirtualNumber', 'CreditcardExpiresMonth', 'CreditcardExpiresYear', 'DiscountPercentage', 'Currency',
    'SendElectronicInvoice', 'IsExcludedFromVat', 'ExclusionVatDefinition', 'Culture', 'IsDeliveryNoteDefault',
    'ShowPriceOnDeliveryNote', 'Language', 'IsElectronicInvoiceWorkNumberRequired',
    'IsElectronicInvoiceOrderNumberRequired', 'IsElectronicInvoiceRequestorRequired',
    'IsElectronicInvoiceAtLeastOneRequired', 'ID'],
  Product: ['ProductNumber', 'Name', 'UnitPrice', 'VatDefinition', 'StockQuantity', 'IsInStockControl'],
  Currency: ['Code', 'Symbol', 'BuyingRate', 'SellingRate'],
  PostalCode: ['Value', 'Name'],
  PaymentMethod: ['ID', 'Name', 'NameEnglish', 'IssuerID'],
  Language: ['ID', 'Name', 'NativeName', 'Value'],
  VatDefinition: ['Key', 'Description', 'Percentage'],
};
// Child element name for array-typed fields.
const ARRAY_ITEM = { InvoiceEntries: 'InvoiceEntry' };
// Which complex type a nested field is.
const FIELD_TYPE = { Customer: 'Customer', Product: 'Product', Currency: 'Currency', PostalCode: 'PostalCode', InvoiceEntry: 'InvoiceEntry',
  PaymentMethod: 'PaymentMethod', Language: 'Language', VatDefinition: 'VatDefinition', ExclusionVatDefinition: 'VatDefinition' };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scalar(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return esc(v);
}

// Serialize an object of a known type in schema order; unknown types keep
// insertion order (fine for operation parameters, which are ordered by us).
function toXml(obj, type) {
  const order = type && FIELD_ORDER[type] ? FIELD_ORDER[type] : Object.keys(obj);
  let out = '';
  for (const k of order) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      const item = ARRAY_ITEM[k] || k;
      out += `<${k}>` + v.map((x) => `<${item}>${toXml(x, FIELD_TYPE[item])}</${item}>`).join('') + `</${k}>`;
    } else if (typeof v === 'object' && !(v instanceof Date)) {
      out += `<${k}>${toXml(v, FIELD_TYPE[k])}</${k}>`;
    } else {
      out += `<${k}>${scalar(v)}</${k}>`;
    }
  }
  return out;
}

/* ── tiny XML reader (enough for .NET SOAP responses) ─────────────────────── */
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
// Parse into nested objects; repeated tags become arrays; leaf text -> string.
function parseXml(xml) {
  const root = { children: {} };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { const t = m[5]; if (t.trim()) stack[stack.length - 1].text = (stack[stack.length - 1].text || '') + t; continue; }
    const [, close, rawName, attrs, selfClose] = m;
    if (rawName.startsWith('?') || rawName.startsWith('!')) continue;
    const name = rawName.includes(':') ? rawName.split(':').pop() : rawName;
    if (close) { stack.pop(); continue; }
    const node = { children: {}, nil: /xsi:nil="true"/.test(attrs) };
    const parent = stack[stack.length - 1];
    (parent.children[name] = parent.children[name] || []).push(node);
    if (!selfClose) stack.push(node);
  }
  const simplify = (n) => {
    const keys = Object.keys(n.children);
    if (!keys.length) return n.nil ? null : (n.text !== undefined ? decode(n.text) : '');
    const o = {};
    for (const k of keys) {
      const arr = n.children[k].map(simplify);
      o[k] = arr.length === 1 ? arr[0] : arr;
    }
    return o;
  };
  return simplify(root);
}
const asArray = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);

function messagesOf(methodResult) {
  if (!methodResult || typeof methodResult !== 'object') return [];
  return asArray(methodResult.Messages && methodResult.Messages.string).map(String);
}
// Drop timing noise when reporting to the admin.
function cleanMessages(msgs) {
  return msgs.filter((m) => !/^INFO_RUNNING_TIME/.test(m));
}

/* ── transport ────────────────────────────────────────────────────────────── */
async function soap(op, params) {
  const url = process.env.REGLA_URL || URL_DEFAULT;
  const body = '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${op} xmlns="${NS}">${params}</${op}></soap:Body></soap:Envelope>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}${op}"` },
    body,
  });
  const text = await res.text();
  const doc = parseXml(text);
  const env = doc.Envelope || {};
  const b = env.Body || {};
  if (b.Fault) {
    const f = b.Fault;
    throw new Error(`Regla ${op}: ${typeof f === 'object' ? f.faultstring : f}`);
  }
  const resp = b[op + 'Response'];
  if (resp === undefined) throw new Error(`Regla ${op}: óvænt svar (HTTP ${res.status})`);
  return resp || {};
}

/* ── session ──────────────────────────────────────────────────────────────── */
let _token = null;
let _tokenAt = 0;
const TOKEN_TTL_MS = 20 * 60 * 1000;

function configured() {
  return !!(process.env.REGLA_USERNAME && process.env.REGLA_PASSWORD);
}

function pickToken(msgs) {
  const parts = msgs.map((m) => { const i = m.indexOf(';'); return i < 0 ? ['', m] : [m.slice(0, i), m.slice(i + 1)]; });
  // Regla 2026 returns the token as a bare message with no "CODE;" prefix,
  // e.g. "d5a8m1…$Ga6O…/qIlUa0…==" (base64-ish: letters, digits, + / = $).
  let hit = parts.find(([c]) => /TOKEN/i.test(c));
  if (!hit) hit = parts.find(([c, v]) => !c && /^\S{16,}$/.test(v.trim()));
  if (!hit) hit = parts.find(([c, v]) => !/^INFO_/.test(c) && /^\S{16,}$/.test(v.trim()));
  return hit ? hit[1].trim() : null;
}

async function login(force) {
  if (!configured()) throw new Error('REGLA_USERNAME / REGLA_PASSWORD eru ekki stillt í Netlify');
  if (!force && _token && Date.now() - _tokenAt < TOKEN_TTL_MS) return _token;
  const r = await soap('Login', toXml({ username: process.env.REGLA_USERNAME, password: process.env.REGLA_PASSWORD }));
  const mr = r.LoginResult || {};
  const msgs = messagesOf(mr);
  if (String(mr.Success) !== 'true') throw new Error('Innskráning í Reglu tókst ekki: ' + cleanMessages(msgs).join(' | '));
  const token = pickToken(msgs);
  if (!token) {
    // Codes only — never echo values, one of them is the token.
    throw new Error('Innskráning tókst en tóki fannst ekki í svari. Kóðar: ' + msgs.map((m) => (m.indexOf(';') < 0 ? '(án kóða, ' + m.length + ' stafir)' : m.split(';')[0])).join(', '));
  }
  _token = token; _tokenAt = Date.now();
  return token;
}

const TOKEN_ERR = /TOKEN|NOT_LOGGED|SESSION|LOGIN/i;

// Call an operation that takes `token` first. Retries once with a fresh login
// if Regla says the token is bad. `resultKey` names the MethodResult element.
async function call(op, paramsObj, resultKey) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cached = attempt === 0 && !!_token;
    const token = await login(attempt > 0);
    let r;
    try {
      r = await soap(op, `<token>${esc(token)}</token>` + paramsObj());
    } catch (e) {
      // An expired/invalid token comes back as a bare SOAP Fault
      // ("Server was unable to process request."), not a MethodResult.
      // Retry once with a fresh login if the token was a cached one.
      if (cached) { _token = null; continue; }
      throw e;
    }
    const mr = r[resultKey || 'result'] || r[op + 'Result'];
    const ok = mr && typeof mr === 'object' && 'Success' in mr ? String(mr.Success) === 'true' : true;
    const msgs = messagesOf(mr);
    if (!ok && attempt === 0 && msgs.some((m) => TOKEN_ERR.test(m.split(';')[0]))) { _token = null; continue; }
    return { r, ok, messages: cleanMessages(msgs) };
  }
  throw new Error(`Regla ${op}: tókst ekki eftir endurinnskráningu`);
}

/* ── products & stock ─────────────────────────────────────────────────────── */
let _products = null;   // { at, bySku: {sku: {...}}, byId: {id: sku} }
const PRODUCTS_TTL_MS = 10 * 60 * 1000;

async function products(force) {
  if (!force && _products && Date.now() - _products.at < PRODUCTS_TTL_MS) return _products;
  const bySku = {}; const byId = {};
  const PAGE = 500;
  for (let from = 0, n = 0; n < 40; n++, from += PAGE) {
    const { r, ok, messages } = await call('SearchProducts',
      () => toXml({ search: '', indexFrom: from, maxRecordCount: PAGE }));
    if (!ok) throw new Error('SearchProducts: ' + messages.join(' | '));
    const list = asArray(r.SearchProductsResult && r.SearchProductsResult.Product);
    for (const p of list) {
      if (!p || !p.ProductNumber) continue;
      const vd = p.VatDefinition && typeof p.VatDefinition === 'object' ? p.VatDefinition : null;
      const rec = {
        id: parseInt(p.ID, 10) || 0,
        sku: String(p.ProductNumber).trim(),
        name: p.Name || '',
        unitPrice: parseFloat(p.UnitPrice) || 0,
        vat: vd && vd.Percentage !== undefined && vd.Percentage !== '' ? parseFloat(vd.Percentage) : null,
        stockControl: String(p.IsInStockControl) === 'true',
        stockQty: parseFloat(p.StockQuantity),
      };
      bySku[rec.sku] = rec;
      if (rec.id) byId[rec.id] = rec.sku;
    }
    if (list.length < PAGE) break;
  }
  _products = { at: Date.now(), bySku, byId };
  return _products;
}

// { sku: { q, ctl } } — q summed over stock rooms (or REGLA_STOCKROOM_ID only).
async function stock() {
  const cat = await products();
  const room = process.env.REGLA_STOCKROOM_ID ? parseInt(process.env.REGLA_STOCKROOM_ID, 10) : null;
  const { r, ok, messages } = await call('GetProductStockQuantities', () => '');
  if (!ok) throw new Error('GetProductStockQuantities: ' + messages.join(' | '));
  const rows = asArray(r.GetProductStockQuantitiesResult && r.GetProductStockQuantitiesResult.ProductStockQuantity);
  const qtyById = {};
  for (const row of rows) {
    if (!row) continue;
    const pid = parseInt(row.ProductID, 10);
    if (room !== null && parseInt(row.StockRoomID, 10) !== room) continue;
    qtyById[pid] = (qtyById[pid] || 0) + (parseFloat(row.Quantity) || 0);
  }
  const out = {};
  for (const sku of Object.keys(cat.bySku)) {
    const p = cat.bySku[sku];
    const q = p.id in qtyById ? qtyById[p.id] : (Number.isFinite(p.stockQty) ? p.stockQty : null);
    out[sku] = { q, ctl: p.stockControl };
  }
  return out;
}

/* ── customers ────────────────────────────────────────────────────────────── */
const ktDigits = (v) => String(v == null ? '' : v).replace(/\D/g, '');

// Parsed SOAP objects carry '' for absent values; an empty <ID></ID> would
// break an int field, so strip empties before sending an object back.
function prune(o) {
  if (Array.isArray(o)) return o.map(prune);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const k of Object.keys(o)) {
    const v = prune(o[k]);
    if (v === '' || v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

async function getCustomer(kt) {
  let res;
  try { res = await call('GetCustomer', () => toXml({ customerNumber: kt })); }
  catch (e) { if (/unable to process/i.test(e.message)) return null; throw e; }
  const c = res.r.GetCustomerResult;
  return res.ok && c && typeof c === 'object' && c.CustomerNumber ? prune(c) : null;
}

// Regla rejects an invoice whose customer has no payment method
// (INFO_PAYMENT_METHOD_NOT_FOUND). REGLA_PAYMENT_METHOD_ID wins; otherwise
// the company's default payment method in Regla.
let _defaultPm = null;
async function defaultPaymentMethod() {
  if (process.env.REGLA_PAYMENT_METHOD_ID) return { ID: parseInt(process.env.REGLA_PAYMENT_METHOD_ID, 10) };
  if (_defaultPm) return _defaultPm;
  const { r, ok } = await call('GetDefaultPaymentMethod', () => '');
  const pm = r.GetDefaultPaymentMethodResult;
  if (ok && pm && typeof pm === 'object' && parseInt(pm.ID, 10) > 0) _defaultPm = prune(pm);
  return _defaultPm;
}
const hasPm = (c) => c && c.PaymentMethod && parseInt(c.PaymentMethod.ID, 10) > 0;

// Full Regla customer record for an invoice, with a name and a payment
// method filled in if Regla's record lacks them. `patched` tells the caller
// to let Regla store those fixes (updateCustomer=true).
async function customerForInvoice(kt, fallbackName) {
  const c = await getCustomer(kt);
  if (!c) return { customer: { CustomerNumber: kt, Name: fallbackName || kt }, patched: true };
  let patched = false;
  if (!c.Name) { c.Name = fallbackName || kt; patched = true; }
  if (!hasPm(c)) { const pm = await defaultPaymentMethod(); if (pm) { c.PaymentMethod = pm; patched = true; } }
  return { customer: c, patched };
}

async function customerExists(kt) {
  let res;
  try {
    res = await call('GetCustomer', () => toXml({ customerNumber: kt }));
  } catch (e) {
    // Some Regla builds fault instead of returning an empty result for an
    // unknown customer number. Treat that as "not found" only when a fresh
    // token is known to be good (login() above just succeeded).
    if (/unable to process/i.test(e.message)) return false;
    throw e;
  }
  const c = res.r.GetCustomerResult;
  return !!(res.ok && c && typeof c === 'object' && c.CustomerNumber);
}

// Create only. An existing Regla customer is never overwritten: the portal
// holds a thinner record than Regla (no payment terms, e-invoice flags…), and
// SaveCustomer with a partial object would blank those fields.
async function ensureCustomer(c) {
  const kt = ktDigits(c.kt);
  if (kt.length !== 10) return { kt, status: 'skipped', messages: ['Ógild kennitala'] };
  if (await customerExists(kt)) return { kt, status: 'exists' };
  const cust = {
    CustomerNumber: kt,
    Name: c.nafn || c.name || kt,
    AddressLine1: c.heimili || undefined,
    PostalCode: c.postnr ? { Value: String(c.postnr).trim() } : undefined,
    Phone1: c.simi || undefined,
    Email: c.netfang || c.email || undefined,
    InvoiceEmail: c.netfang || c.email || undefined,
    PaymentMethod: (await defaultPaymentMethod()) || undefined,
    DiscountPercentage: 0,
    Currency: { Code: 'ISK' },
  };
  const { ok, messages } = await call('SaveCustomer', () => '<customer>' + toXml(cust, 'Customer') + '</customer>', 'SaveCustomerResult');
  return { kt, status: ok ? 'created' : 'error', messages };
}

/* ── invoices (drafts) ────────────────────────────────────────────────────── */
const r2 = (n) => Math.round(n * 100) / 100;

function priceBasis(prod, retailGross, vat) {
  const env = (process.env.REGLA_PRICE_BASIS || 'auto').toLowerCase();
  if (env === 'gross' || env === 'net') return env;
  if (!prod.unitPrice || !retailGross) return 'gross';
  const gross = Math.abs(prod.unitPrice - retailGross);
  const net = Math.abs(prod.unitPrice * (1 + vat / 100) - retailGross);
  return net < gross ? 'net' : 'gross';
}

// order: { id, date, kt, note, paidByCard, lines: [{ sku, name, qty, retail, paid }] }
// retail/paid are per-unit ISK incl. VSK, exactly as the Sölusaga CSV.
async function buildInvoice(order) {
  const cat = await products();
  const errors = []; const warnings = [];
  const entries = [];
  let total = 0, vatTotal = 0, discTotal = 0;
  const date = order.date ? new Date(order.date) : new Date();
  const defVat = parseFloat(process.env.REGLA_DEFAULT_VAT || '11');

  for (const l of order.lines || []) {
    const sku = String(l.sku || '').trim();
    const prod = sku && cat.bySku[sku];
    if (!prod) { errors.push(`Vörunúmer ${sku || '(vantar)'} finnst ekki í Reglu — ${l.name}`); continue; }
    const qty = Number(l.qty) || 1;
    const paid = Number(l.paid) || 0;
    const retail = Number(l.retail) || 0;
    let vat = prod.vat;
    if (vat === null || !Number.isFinite(vat)) { vat = defVat; warnings.push(`${sku}: enginn VSK í Reglu, notaði ${defVat}%`); }

    const unitGross = retail > paid ? retail : paid;
    const disc = retail > paid ? Math.round((1 - paid / retail) * 1e6) / 1e4 : 0;   // %
    const basis = priceBasis(prod, unitGross, vat);
    const unit = basis === 'net' ? r2(unitGross / (1 + vat / 100)) : unitGross;
    const amount = r2(unit * qty * (1 - disc / 100));
    const vatAmt = basis === 'net' ? r2(amount * vat / 100) : r2(amount - amount / (1 + vat / 100));
    total += basis === 'net' ? amount + vatAmt : amount;
    vatTotal += vatAmt;
    discTotal += r2(unit * qty * disc / 100);

    entries.push({
      Product: { ProductNumber: sku },
      Quantity: qty,
      Text: prod.name || l.name || undefined,
      Amount: amount,
      UnitPrice: unit,
      VatPercentage: vat,
      VatAmount: vatAmt,
      Discount: disc,
      IsDiscountPercentage: true,
      Date: date,
      Type: 'Normal',
    });
  }

  const kt = ktDigits(order.kt);
  if (kt.length !== 10) errors.push('Kennitala kaupanda vantar eða er ógild');
  if (!entries.length) errors.push('Engar línur');

  const comment = [order.note, order.paidByCard ? 'Greitt með korti (Teya) á heildsöluvef' : null]
    .filter(Boolean).join(' · ') || undefined;

  const invoice = {
    Customer: { CustomerNumber: kt },
    Concerning: `Heildsölupöntun ${order.id}`,
    Comment: comment,
    InvoiceEntries: entries,
    Amount: r2(total),
    DiscountAmount: r2(discTotal),
    VatAmount: r2(vatTotal),
    Currency: { Code: 'ISK' },
    Date: date,
    Type: 'Invoice',
    UniqueReference: String(order.id),
    ApplicationName: 'wholesale.seidkarlinn.is',
    ApplicationVersion: '1',
  };
  return { invoice, errors, warnings };
}

// Saved (unissued) invoice = draft to review and issue in Regla.
// The Customer sent is Regla's own full record (customerForInvoice), so
// updateCustomer=true only ever writes back that record plus the missing
// name/payment method. updateProducts stays false: Product is a reference.
async function saveDraftInvoice(invoice, updateCustomer) {
  const { ok, messages } = await call('SaveInvoiceWithUpdateAndValidationOptions',
    () => '<invoice>' + toXml(invoice, 'Invoice') + '</invoice>' +
      toXml({ updateCustomer: !!updateCustomer, updateProducts: false, validateInvoice: true }),
    'SaveInvoiceWithUpdateAndValidationOptionsResult');
  return { ok, messages };
}

module.exports = {
  configured, login, soap, call, toXml, parseXml, products, stock,
  ensureCustomer, getCustomer, customerForInvoice, defaultPaymentMethod,
  buildInvoice, saveDraftInvoice, cleanMessages, ktDigits,
};
