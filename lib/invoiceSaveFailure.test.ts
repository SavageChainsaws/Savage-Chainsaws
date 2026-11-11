import { describe, it, expect } from 'vitest'
import { invoiceNotSavedResponse } from './invoiceSaveFailure'

describe('invoiceNotSavedResponse', () => {
  it('returns 200 with an HTML content-type - not an error status', async () => {
    const res = invoiceNotSavedResponse({ pdfBuffer: Buffer.from('fake-pdf'), invoiceNumber: 'SC-0099', reason: 'Something failed.' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('embeds the PDF as a downloadable data URI so nothing is lost on a failed save', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-bytes')
    const res = invoiceNotSavedResponse({ pdfBuffer, invoiceNumber: 'SC-0099', reason: 'Something failed.' })
    const html = await res.text()
    expect(html).toContain(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`)
  })

  it('HTML-escapes the reason - it may embed a raw Postgres/Storage error message', async () => {
    const res = invoiceNotSavedResponse({ pdfBuffer: Buffer.from('x'), invoiceNumber: 'SC-0099', reason: '<script>alert(1)</script> & "quoted"' })
    const html = await res.text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('strips anything but alphanumerics/hyphens from the invoice number before using it in the filename/title', async () => {
    const res = invoiceNotSavedResponse({ pdfBuffer: Buffer.from('x'), invoiceNumber: 'SC-0099"><img src=x>', reason: 'x' })
    const html = await res.text()
    expect(html).toContain('invoice-SC-0099imgsrcx.pdf')
    expect(html).not.toContain('"><img src=x>')
  })
})
