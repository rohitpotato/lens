import type { SynthInvoice } from './generate.js';

/**
 * Synthesized receipts. Reuses the invoice PDF layout (title says "INVOICE"
 * but classify keys off content patterns — vendor+total+lines look receipt-ish
 * enough for a demo fixture). The corpus signal is: fixture pipeline is
 * schema-agnostic.
 */
export const RECEIPT_CORPUS: SynthInvoice[] = [
  {
    fixtureId: 'rec_001_cafe_usd',
    vendorName: 'Ridgeway Coffee',
    vendorAddress: '89 Ridgeway Lane, Portland, OR 97205',
    invoiceNumber: 'R-8842',
    invoiceDate: '2025-05-04',
    currency: 'USD',
    taxRate: 0.09,
    lines: [
      { description: 'Espresso, double', quantity: 2, unitPrice: 4.5 },
      { description: 'Almond croissant', quantity: 1, unitPrice: 5.25 },
      { description: 'Bottled sparkling water', quantity: 1, unitPrice: 3.5 },
    ],
  },
];
