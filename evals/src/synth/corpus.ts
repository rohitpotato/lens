import type { SynthInvoice } from './generate.js';

/**
 * Curated synthetic invoices. Kept deliberately small and diverse:
 * currency mix, tax present / absent, single vs many line items, credits.
 */
export const CORPUS: SynthInvoice[] = [
  {
    fixtureId: 'syn_001_simple_usd',
    vendorName: 'Acme Widgets, Inc.',
    vendorAddress: '221B Baker Street, Springfield, IL 62701',
    invoiceNumber: 'AW-2025-0007',
    invoiceDate: '2025-06-01',
    dueDate: '2025-06-30',
    currency: 'USD',
    taxRate: 0.0725,
    shippingAmount: 45.0,
    lines: [
      { description: 'Widget assembly (blue)', quantity: 100, unitPrice: 12.5 },
      { description: 'Widget assembly (red)', quantity: 50, unitPrice: 12.5 },
    ],
  },
  {
    fixtureId: 'syn_002_no_tax_eur',
    vendorName: 'Bergstrom Consulting AB',
    vendorAddress: 'Kungsgatan 12, 111 43 Stockholm, Sweden',
    invoiceNumber: 'BC-2025-142',
    invoiceDate: '2025-04-15',
    currency: 'EUR',
    lines: [
      { description: 'Strategy workshop, 2 days', quantity: 2, unitPrice: 3200.0 },
      { description: 'Report preparation', quantity: 8, unitPrice: 180.0 },
    ],
  },
  {
    fixtureId: 'syn_003_many_lines_inr',
    vendorName: 'Kumar Supply Co.',
    vendorAddress: 'Plot 34, MIDC Andheri East, Mumbai 400093',
    invoiceNumber: 'KSC/2025/0891',
    invoiceDate: '2025-05-20',
    dueDate: '2025-06-19',
    currency: 'INR',
    taxRate: 0.18,
    shippingAmount: 500.0,
    lines: [
      { description: 'Stainless bolts M6x20 (bag of 100)', quantity: 40, unitPrice: 145.0 },
      { description: 'Stainless nuts M6 (bag of 100)', quantity: 40, unitPrice: 95.0 },
      { description: 'Washers M6 (bag of 200)', quantity: 20, unitPrice: 60.0 },
      { description: 'Threaded rod M6 (1m)', quantity: 30, unitPrice: 240.0 },
      { description: 'Bench vise 4in', quantity: 3, unitPrice: 3200.0 },
      { description: 'Toolbox steel 22in', quantity: 5, unitPrice: 1750.0 },
    ],
  },
  {
    fixtureId: 'syn_004_single_line_gbp',
    vendorName: 'Thames Design Studio',
    invoiceNumber: 'TDS-9004',
    invoiceDate: '2025-07-10',
    currency: 'GBP',
    taxRate: 0.2,
    lines: [{ description: 'Brand system refresh (fixed fee)', quantity: 1, unitPrice: 18500.0 }],
  },
  {
    fixtureId: 'syn_005_high_precision_usd',
    vendorName: 'Precise Instruments LLC',
    vendorAddress: '445 Industrial Way, San Jose, CA 95112',
    invoiceNumber: '25-PI-004421',
    invoiceDate: '2025-03-28',
    dueDate: '2025-04-27',
    currency: 'USD',
    taxRate: 0.0825,
    lines: [
      { description: 'Calibration service — micrometer set', quantity: 12, unitPrice: 87.4 },
      { description: 'Certificate of traceability', quantity: 12, unitPrice: 15.0 },
      { description: 'Rush handling (48h)', quantity: 1, unitPrice: 125.0 },
    ],
  },
];
