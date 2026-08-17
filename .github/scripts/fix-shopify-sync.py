#!/usr/bin/env python3
"""One-shot slot: reikningur -> afhendingarseðill (delivery note / packing list).

The previous payload (per-user discount fix, fix-user-discount.py) has shipped.
This slot now carries the next one-shot change, following the established
pattern: the fix-shopify-sync.yml workflow triggers on pushes to this file,
runs it, and the script commits + pushes the patched index.html.

Payload: both checkout paths — reikningsviðskipti (invoiceCheckout) and
staðgreiðsla/kortagreiðsla (downloadOrderPDF) — produced an invoice PDF. They
now produce a delivery note / packing list instead: title AFHENDINGARSEÐILL,
per-line pick checkbox, prominent quantities, line/unit counts, signature row,
no payment terms or bank details. Prices, VSK and the shipment value are kept.

Idempotent — exits 0 with no changes when index.html is already patched.
"""
import io, pathlib, subprocess, sys

P = pathlib.Path("index.html")


def rep(s, old, new):
    if old not in s:
        sys.exit("PATCH ABORTED - anchor not found:\n" + old[:200])
    return s.replace(old, new)


def apply_patch() -> bool:
    """Rewrite the generated document. Returns False if already patched."""
    s = io.open(P, encoding="utf-8").read()
    if "AFHENDINGARSEÐILL" in s:
        print("index.html already patched; nothing to do.")
        return False

    # ── 1. Document head ──────────────────────────────────────────────────
    s = rep(s, '<title>Reikningur ${invoiceNo} — Seiðkarlinn</title>',
               '<title>Afhendingarseðill ${invoiceNo} — Seiðkarlinn</title>')

    # ── 2. Header meta block ──────────────────────────────────────────────
    s = rep(s, '''  <div class="invoice-meta">
    <div class="invoice-title">REIKNINGUR</div>
    <table class="meta-table">
      <tr><td>Reikningsnúmer:</td><td>${invoiceNo}</td></tr>
      <tr><td>Útgáfudagur:</td><td>${formatDate(today)}</td></tr>
      <tr><td>Gjalddagi:</td><td class="due-highlight">${formatDate(due)}</td></tr>
    </table>
  </div>''',
'''  <div class="invoice-meta">
    <div class="invoice-title">AFHENDINGARSEÐILL</div>
    <div class="invoice-subtitle">Fylgiseðill / tínslulisti — ekki reikningur</div>
    <table class="meta-table">
      <tr><td>Afhendingarseðill / pöntun nr.:</td><td>${invoiceNo}</td></tr>
      <tr><td>Dagsetning:</td><td>${formatDate(today)}</td></tr>
      <tr><td>Greiðslumáti:</td><td>${esc(payLabel)}</td></tr>
    </table>
  </div>''')

    # ── 3. Party labels ───────────────────────────────────────────────────
    s = rep(s, '<div class="party-label">Seljandi</div>',
               '<div class="party-label">Sendandi</div>')
    s = rep(s, '<div class="party-label">Kaupandi</div>',
               '<div class="party-label">Móttakandi — afhendingarstaður</div>')

    # ── 4. Items table head: pick column ──────────────────────────────────
    s = rep(s, '''      <th style="text-align:left;width:50%">Vara / þjónusta</th>
      <th style="text-align:center;width:8%">Magn</th>
      <th style="text-align:right;width:14%">Einingarverð</th>
      <th style="text-align:center;width:8%">VSK%</th>
      <th style="text-align:right;width:12%">VSK kr.</th>
      <th style="text-align:right;width:14%">Samtals (ISK)</th>''',
'''      <th style="text-align:center;width:5%">✓</th>
      <th style="text-align:left;width:41%">Vara</th>
      <th style="text-align:center;width:9%">Magn</th>
      <th style="text-align:right;width:13%">Einingarverð</th>
      <th style="text-align:center;width:7%">VSK%</th>
      <th style="text-align:right;width:11%">VSK kr.</th>
      <th style="text-align:right;width:14%">Samtals (ISK)</th>''')

    # ── 5. Line rows: checkbox cell + prominent quantity ──────────────────
    s = rep(s, '''  const lineRows = lines.map(l => `
    <tr>
      <td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:11px">${esc(l.name)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:center">${l.qty}</td>''',
'''  const lineRows = lines.map(l => `
    <tr>
      <td style="padding:7px 8px;border-bottom:1px solid #eee;text-align:center"><span class="pick-box"></span></td>
      <td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:11px">${esc(l.name)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:13px;font-weight:700;text-align:center">${l.qty}</td>''')

    # ── 6. Summary rows: line/unit counts ─────────────────────────────────
    s = rep(s, '''  const vskSummary = `
    <tr><td colspan="5" style="padding:4px 8px;font-size:11px;color:#555">Samtals án VSK</td>
        <td style="padding:4px 8px;font-size:11px;text-align:right">${fmtNum(totalExVsk)}</td></tr>
    ${(totalVsk24 + (totalVsk0 > 0 ? 0 : 0)) >= 0 ? `<tr><td colspan="5" style="padding:4px 8px;font-size:11px;color:#555">Samtals VSK</td>
        <td style="padding:4px 8px;font-size:11px;text-align:right">${fmtNum(totalVsk24)}</td></tr>` : ''}`;''',
'''  const totalUnits = lines.reduce((s,l) => s + (parseInt(l.qty) || 0), 0);

  const vskSummary = `
    <tr><td colspan="5" style="padding:4px 8px;font-size:11px;color:#555">Fjöldi vörulína / eininga</td>
        <td style="padding:4px 8px;font-size:11px;text-align:right">${lines.length} / ${totalUnits}</td></tr>
    <tr><td colspan="5" style="padding:4px 8px;font-size:11px;color:#555">Samtals án VSK</td>
        <td style="padding:4px 8px;font-size:11px;text-align:right">${fmtNum(totalExVsk)}</td></tr>
    <tr><td colspan="5" style="padding:4px 8px;font-size:11px;color:#555">Samtals VSK</td>
        <td style="padding:4px 8px;font-size:11px;text-align:right">${fmtNum(totalVsk24)}</td></tr>`;''')

    # ── 7. Grand total label ──────────────────────────────────────────────
    s = rep(s, '''  <tr class="grand-total">
    <td colspan="5" style="padding:8px">Heildarupphæð</td>''',
'''  <tr class="grand-total">
    <td colspan="5" style="padding:8px">Verðmæti sendingar</td>''')

    # ── 8. Payment box -> delivery + signature box ────────────────────────
    s = rep(s, '''<div class="payment-box">
  <div class="payment-title">💳 Greiðsluupplýsingar</div>
  <div class="payment-detail">
    <strong>Greiðist innan 14 daga frá útgáfudegi reiknings.</strong><br>
    Gjalddagi: <strong class="due-highlight">${formatDate(due)}</strong><br>
    Reikningur: <strong>${invoiceNo}</strong><br>
    <br>
    Banki: <strong>0515 - Íslandsbanki</strong><br>
    Reikningsnúmer: <strong>0515-26-011733</strong><br>
    Tilvísunarnúmer: ${invoiceNo}
  </div>
</div>''',
'''<div class="payment-box">
  <div class="payment-title">📦 Afhending</div>
  <div class="payment-detail">
    Fjöldi vörulína: <strong>${lines.length}</strong> &nbsp;|&nbsp; Fjöldi eininga: <strong>${totalUnits}</strong><br>
    Greiðslumáti: <strong>${esc(payLabel)}</strong><br>
    Farðu yfir listann og hakaðu við hverja vöru þegar hún hefur verið tínd og pakkað.
  </div>
  <div class="sign-row">
    <div class="sign-cell"><div class="sign-line"></div>Tínt / pakkað af</div>
    <div class="sign-cell"><div class="sign-line"></div>Dagsetning</div>
    <div class="sign-cell"><div class="sign-line"></div>Móttekið af (undirskrift)</div>
  </div>
</div>''')

    # ── 9. Legal note ─────────────────────────────────────────────────────
    s = rep(s, '''<div class="legal-note">
  Þessi reikningur er gefinn út í samræmi við lög nr. 50/1988 um virðisaukaskatt og reglur um bókhaldsskyldu
  skv. lögum nr. 145/1994. VSK-skráning: ${SELLER.vsk}.
  Vanskil bera dráttarvexti skv. lögum nr. 38/2001 frá gjalddaga.
  Reikningur nr. ${invoiceNo} — ${SELLER.name} — Kt. ${SELLER.kt}.
</div>''',
'''<div class="legal-note">
  <strong>Þetta skjal er afhendingarseðill (fylgiseðill) — ekki reikningur og ekki greiðslukvittun.</strong>
  Verð eru sýnd til upplýsingar um verðmæti sendingar. Reikningur er gefinn út sérstaklega.
  Athugasemdir við sendinguna skal tilkynna innan 7 daga frá afhendingu á ${SELLER.email}.
  Afhendingarseðill nr. ${invoiceNo} — ${SELLER.name} — Kt. ${SELLER.kt}.
</div>''')

    # ── 10. Styles ────────────────────────────────────────────────────────
    s = rep(s, '''  .due-highlight { color: #2A5C2A; font-weight: 700; }''',
'''  .due-highlight { color: #2A5C2A; font-weight: 700; }
  .invoice-subtitle { font-size: 10px; color: #888; margin-bottom: 8px; letter-spacing: .04em; }
  .pick-box { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #999; border-radius: 3px; }
  .sign-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-top: 18px; }
  .sign-cell { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: .06em; }
  .sign-line { border-bottom: 1px solid #999; height: 26px; margin-bottom: 4px; }''')

    # ── 11. Generator function: rename + payLabel ─────────────────────────
    s = rep(s, '''function generateInvoicePDF(data) {
  const { invoiceNo, today, due, buyerName, buyerEmail, buyerKt, buyerAddr,
          note, lines, totalGross, totalExVsk, totalVsk24, totalVsk0 } = data;''',
'''function generateDeliveryNote(data) {
  const { invoiceNo, today, due, buyerName, buyerEmail, buyerKt, buyerAddr,
          note, lines, totalGross, totalExVsk, totalVsk24, totalVsk0 } = data;
  const payLabel = data.payLabel || 'Reikningsviðskipti · 14 dagar';''')

    s = rep(s, '// ── PDF Generation ────────────────────────────────────',
               '// ── Afhendingarseðill (delivery note / packing list) ──')

    # ── 12. Blob, toasts, filename ────────────────────────────────────────
    s = rep(s, '''  const invoiceHTML = `<!DOCTYPE html>''',
               '''  const deliveryHTML = `<!DOCTYPE html>''')

    s = rep(s, '''  // Open invoice in new tab — browser prints/saves as PDF
  const blob = new Blob([invoiceHTML], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const tab  = window.open(url, '_blank');
  if (tab) {
    showToast('📄 Reikningur opnaður — veldu "Vista sem PDF" í prentglugganum', 4000);
  } else {
    // Popup blocked — download as HTML file instead
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Reikningur-' + invoiceNo + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📄 Reikningur vistaður — opnaðu skrána í vafra og prentaðu sem PDF', 5000);
  }''',
'''  // Open delivery note in new tab — browser prints/saves as PDF
  const blob = new Blob([deliveryHTML], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const tab  = window.open(url, '_blank');
  if (tab) {
    showToast('📦 Afhendingarseðill opnaður — veldu "Vista sem PDF" í prentglugganum', 4000);
  } else {
    // Popup blocked — download as HTML file instead
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Afhendingarsedill-' + invoiceNo + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📦 Afhendingarseðill vistaður — opnaðu skrána í vafra og prentaðu sem PDF', 5000);
  }''')

    # ── 13. invoiceCheckout (reikningsviðskipti) ──────────────────────────
    s = rep(s, """  const btn = document.getElementById('invoiceBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Bý til reikning…';""",
"""  const btn = document.getElementById('invoiceBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Bý til afhendingarseðil…';""")

    s = rep(s, """    // Generate and download PDF first (fail fast - don't log order if this throws)
    generateInvoicePDF({
      invoiceNo, today, due, buyerName, buyerEmail, buyerKt, buyerAddr, note, lines,
      totalGross, totalExVsk, totalVsk24, totalVsk0,
    });""",
"""    // Generate delivery note first (fail fast - don't log order if this throws)
    generateDeliveryNote({
      invoiceNo, today, due, buyerName, buyerEmail, buyerKt, buyerAddr, note, lines,
      totalGross, totalExVsk, totalVsk24, totalVsk0,
      payLabel: 'Reikningsviðskipti · greiðist innan 14 daga',
    });""")

    s = rep(s, """    showToast('✓ Reikningur ' + invoiceNo + ' búinn til!', 4000);""",
               """    showToast('✓ Afhendingarseðill ' + invoiceNo + ' búinn til!', 4000);""")

    s = rep(s, """    console.error('Invoice error:', err);
    showToast('⚠️ Villa við að búa til reikning: ' + err.message, 4000);""",
"""    console.error('Delivery note error:', err);
    showToast('⚠️ Villa við að búa til afhendingarseðil: ' + err.message, 4000);""")

    # ── 14. downloadOrderPDF (card / staðgreiðsla orders) ─────────────────
    s = rep(s, """// ══════════════════════════════════════════════════════
// REIKNINGUR Í PDF — Sækja reikning fyrir pöntun
// ══════════════════════════════════════════════════════

function downloadOrderPDF(orderId) {""",
"""// ══════════════════════════════════════════════════════
// AFHENDINGARSEÐILL Í PDF — Sækja fylgiseðil fyrir pöntun
// ══════════════════════════════════════════════════════

function downloadOrderPDF(orderId) {""")

    s = rep(s, """  generateInvoicePDF({
    invoiceNo,
    today,
    due,""",
"""  generateDeliveryNote({
    invoiceNo,
    today,
    due,
    payLabel: o.status === 'invoice'
      ? 'Reikningsviðskipti · greiðist innan 14 daga'
      : 'Staðgreitt · kortagreiðsla',""")

    s = rep(s, """      total:   lineTotal,   // generateInvoicePDF expects l.total""",
               """      total:   lineTotal,   // generateDeliveryNote expects l.total""")

    # ── 15. UI labels ─────────────────────────────────────────────────────
    s = rep(s, """    <div class="checkout-note">Reikningur sendur á tölvupóst · Greiðist innan 14 daga</div>""",
               """    <div class="checkout-note">Afhendingarseðill prentast við pöntun · Greiðist innan 14 daga</div>""")

    s = rep(s, """style="width:100%">📄 Sækja reikning í PDF</button>""",
               """style="width:100%">📦 Sækja afhendingarseðil í PDF</button>""")
    s = rep(s, """                      📄 Sækja reikning í PDF""",
               """                      📦 Sækja afhendingarseðil í PDF""")
    s = rep(s, """              📄 Sækja reikning í PDF""",
               """              📦 Sækja afhendingarseðil í PDF""")

    s = rep(s, """        <div class="cat-title">🧾 Reikningar</div>
        <div class="cat-sub">${orders.length} reikningur${orders.length !== 1 ? 'ar' : ''}</div>""",
"""        <div class="cat-title">📦 Afhendingarseðlar</div>
        <div class="cat-sub">${orders.length} afhendingarseðill${orders.length !== 1 ? 'ar' : ''}</div>""")

    s = rep(s, """    ${!orders.length ? `<div class="no-data">🧾 Engir reikningar fundust.</div>` : `""",
               """    ${!orders.length ? `<div class="no-data">📦 Engir afhendingarseðlar fundust.</div>` : `""")

    io.open(P, "w", encoding="utf-8").write(s)
    print("index.html patched: reikningur -> afhendingarseðill")
    return True


def main() -> None:
    if not apply_patch():
        return

    changed = subprocess.run(["git", "diff", "--quiet", "--", "index.html"]).returncode != 0
    if not changed:
        print("index.html unchanged; nothing to commit.")
        return
    run = lambda *a: subprocess.run(list(a), check=True)
    run("git", "config", "user.name", "seidkarlinn-bot")
    run("git", "config", "user.email", "bot@seidkarlinn.is")
    run("git", "add", "index.html")
    run("git", "commit", "-m",
        "feat: afhendingarsedill (fylgisedill) i stad reiknings i badum greidsluferlum\n\n"
        "Bade reikningsvidskipti (invoiceCheckout) og stadgreidsla/kortagreidsla\n"
        "(downloadOrderPDF) kolludu i generateInvoicePDF og prentudu reikning.\n"
        "Nu kalla thau bædi i generateDeliveryNote sem prentar afhendingarsedil:\n"
        "titill AFHENDINGARSEDILL, hokunarreitur a hverja linu, staerra magn,\n"
        "fjoldi linu/eininga, undirskriftarreitir og engar greidsluupplysingar\n"
        "(banki, gjalddagi, krofulysing). Verd, VSK og heildarverdmaeti haldast.\n"
        "Hnappar og spjold: 'Saekja reikning i PDF' -> 'Saekja afhendingarsedil i\n"
        "PDF', 'Reikningar' -> 'Afhendingarsedlar'. [skip ci]")
    run("git", "push")
    print("Pushed.")


if __name__ == "__main__":
    main()
