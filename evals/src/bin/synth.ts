import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { CORPUS } from '../synth/corpus.js';
import { renderInvoice, toExpected } from '../synth/generate.js';
import { REPO_ROOT } from '../schema-loader.js';

async function main() {
  const fixturesDir = path.join(REPO_ROOT, 'evals/fixtures');
  await mkdir(fixturesDir, { recursive: true });

  for (const inv of CORPUS) {
    const dir = path.join(fixturesDir, inv.fixtureId);
    await mkdir(dir, { recursive: true });

    const pdfPath = path.join(dir, 'input.pdf');
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(pdfPath);
      stream.on('error', reject);
      renderInvoice(inv, stream).catch(reject);
      stream.on('finish', () => resolve());
    });

    const expected = toExpected(inv);
    await writeFile(path.join(dir, 'expected.yaml'), yamlStringify(expected));

    const meta = {
      source: 'synth',
      currency: inv.currency,
      has_tax: inv.taxRate != null,
      line_item_count: inv.lines.length,
      features: [
        inv.taxRate == null ? 'no-tax-line' : null,
        inv.lines.length >= 6 ? 'many-line-items' : null,
        inv.lines.length === 1 ? 'single-line-item' : null,
        inv.currency !== 'USD' ? 'non-usd' : null,
      ].filter((x): x is string => x !== null),
    };
    await writeFile(path.join(dir, 'metadata.yaml'), yamlStringify(meta));

    // eslint-disable-next-line no-console
    console.log(`wrote fixture ${inv.fixtureId}`);
  }
}

void main();
