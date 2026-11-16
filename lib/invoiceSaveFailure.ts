import { NextResponse } from 'next/server'
import { escapeHtml } from './text'

// Every invoice creation/edit route renders the PDF FIRST, then tries to
// persist it (an `invoices` row insert/update, a Storage upload, a
// `pdf_url` write) - previously, if that persistence step failed for any
// reason, the route still handed the admin back the freshly-rendered PDF
// with a 200, exactly as if everything had worked. The admin had no way to
// tell a real invoice from one that only ever existed as a PDF in their
// browser tab - that's exactly what happened to a Reliable Lawn Services
// invoice (SC-0055, 2026-11): rendered, texted to the customer as a
// screenshot, but never actually saved with a pdf_url, so the customer
// could never open it from their own portal ("I can't see the invoice").
//
// This is the fallback response for that case. It still hands back the
// rendered PDF (as a download link, same content the admin would have
// gotten before) so there's no regression in "at least I have something to
// send the customer right now" - but as an HTML page that says plainly
// what did and didn't get saved, instead of a 200 PDF response
// indistinguishable from success. Works unchanged for every way these
// routes get called, including a plain <form action=... target="_blank">
// POST (see CreateUnitInvoiceForm.tsx), which can't inspect a response
// status or body shape at all - just whatever the browser tab ends up
// rendering. A real HTML page in that tab is something a human will
// actually read, unlike a JSON error body a raw form post has no way to
// parse.
//
// Returns 200 (not 4xx/5xx) on purpose: a fetch-based form here already
// treats ANY non-ok status as the PDF never having rendered at all (it
// closes the pre-opened tab and shows its own inline error, see
// CreateCustomInvoiceForm.tsx/EditInvoiceForm.tsx) - but the PDF here DID
// render successfully; only saving it afterward partly or fully failed.
// Letting the pre-opened tab navigate to this real page (200, `res.ok`
// true) is the accurate outcome, not the full-failure path those forms
// already have.
export function invoiceNotSavedResponse({
  pdfBuffer,
  invoiceNumber,
  reason,
}: {
  pdfBuffer: Buffer
  invoiceNumber: string
  reason: string
}): NextResponse {
  const base64 = pdfBuffer.toString('base64')
  const safeInvoiceNumber = invoiceNumber.replace(/[^A-Za-z0-9-]/g, '')
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${safeInvoiceNumber} - not saved</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #18181b; color: #fafafa; padding: 32px 20px; max-width: 560px; margin: 0 auto; line-height: 1.5; }
  h1 { color: #f59e0b; font-size: 18px; }
  p { color: #d4d4d8; }
  a.btn { display: inline-block; margin-top: 18px; background: #ea580c; color: #ffffff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
  <h1>Invoice ${safeInvoiceNumber} was generated but not fully saved</h1>
  <p>${escapeHtml(reason)}</p>
  <p>The PDF itself still rendered fine - download it below if you need to send it to the customer right now anyway, then try again (or use Edit) once the underlying issue is fixed.</p>
  <a class="btn" href="data:application/pdf;base64,${base64}" download="invoice-${safeInvoiceNumber}.pdf">Download the PDF anyway</a>
</body>
</html>`
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
