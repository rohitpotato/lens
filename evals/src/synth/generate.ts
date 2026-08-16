import PDFDocument from 'pdfkit';
import type { Writable } from 'node:stream';

export type SynthLine = { description: string; quantity: number; unitPrice: number };
export type SynthInvoice = {
  fixtureId: string;
  vendorName: string;
  vendorAddress?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'INR';
  taxRate?: number;
  lines: SynthLine[];
  /** Rendered as a separate labeled row (NOT in the line-items table). */
  shippingAmount?: number;
  /** Rendered as a separate labeled row, positive number that reduces total. */
  discountAmount?: number;
};

/**
 * Renders a plausible invoice PDF to a stream. Deterministic layout so
 * regressions in the extractor are attributable to prompt changes, not
 * source variance.
 */
export function renderInvoice(inv: SynthInvoice, out: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    doc.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);

    doc.fontSize(20).text('INVOICE', { align: 'right' });
    doc.moveDown();
    doc.fontSize(11).text(inv.vendorName, { continued: false });
    if (inv.vendorAddress) doc.fontSize(9).fillColor('#555').text(inv.vendorAddress);
    doc.fillColor('#000');
    doc.moveDown();
    doc.fontSize(10).text(`Invoice #: ${inv.invoiceNumber}`);
    doc.text(`Invoice Date: ${inv.invoiceDate}`);
    if (inv.dueDate) doc.text(`Due Date: ${inv.dueDate}`);
    doc.text(`Currency: ${inv.currency}`);
    doc.moveDown();

    // header row
    const cols = { desc: 50, qty: 320, unit: 380, amt: 470 };
    const headerY = doc.y;
    doc.fontSize(10).fillColor('#333');
    doc.text('Description', cols.desc, headerY);
    doc.text('Qty', cols.qty, headerY);
    doc.text('Unit', cols.unit, headerY);
    doc.text('Amount', cols.amt, headerY);
    doc.moveTo(50, headerY + 15).lineTo(560, headerY + 15).stroke();
    doc.moveDown(1);
    doc.fillColor('#000');

    let subtotal = 0;
    for (const line of inv.lines) {
      const y = doc.y;
      const amount = round2(line.quantity * line.unitPrice);
      subtotal = round2(subtotal + amount);
      doc.text(line.description, cols.desc, y, { width: 250 });
      doc.text(String(line.quantity), cols.qty, y);
      doc.text(line.unitPrice.toFixed(2), cols.unit, y);
      doc.text(amount.toFixed(2), cols.amt, y);
      doc.moveDown(0.5);
    }

    doc.moveDown();
    const taxAmount = inv.taxRate ? round2(subtotal * inv.taxRate) : 0;
    const shippingAmount = inv.shippingAmount ?? 0;
    const discountAmount = inv.discountAmount ?? 0;
    const total = round2(subtotal + taxAmount + shippingAmount - discountAmount);
    doc.text(`Subtotal: ${subtotal.toFixed(2)}`, { align: 'right' });
    if (inv.taxRate) doc.text(`Tax (${(inv.taxRate * 100).toFixed(1)}%): ${taxAmount.toFixed(2)}`, { align: 'right' });
    if (inv.shippingAmount) doc.text(`Shipping: ${shippingAmount.toFixed(2)}`, { align: 'right' });
    if (inv.discountAmount) doc.text(`Discount: -${discountAmount.toFixed(2)}`, { align: 'right' });
    doc.fontSize(12).text(`Total: ${total.toFixed(2)}`, { align: 'right' });

    doc.end();
  });
}

export function toExpected(inv: SynthInvoice): Record<string, unknown> {
  const lines = inv.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_price: round2(l.unitPrice),
    amount: round2(l.quantity * l.unitPrice),
  }));
  const subtotal = round2(lines.reduce((a, l) => a + (l.amount as number), 0));
  const taxAmount = inv.taxRate ? round2(subtotal * inv.taxRate) : null;
  const shippingAmount = inv.shippingAmount ?? null;
  const discountAmount = inv.discountAmount ?? null;
  const total = round2(subtotal + (taxAmount ?? 0) + (shippingAmount ?? 0) - (discountAmount ?? 0));
  const out: Record<string, unknown> = {
    vendor_name: inv.vendorName,
    invoice_number: inv.invoiceNumber,
    invoice_date: inv.invoiceDate,
    currency: inv.currency,
    subtotal,
    total,
    line_items: lines,
  };
  if (inv.vendorAddress) out['vendor_address'] = inv.vendorAddress;
  if (inv.dueDate) out['due_date'] = inv.dueDate;
  if (taxAmount != null) out['tax_amount'] = taxAmount;
  if (shippingAmount != null) out['shipping_amount'] = shippingAmount;
  if (discountAmount != null) out['discount_amount'] = discountAmount;
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
