import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { docileToExpected } from '../import/docile-mapper.js';
import { loadInvoiceSchemaFromDisk, REPO_ROOT } from '../schema-loader.js';

/**
 * Imports the one DocILE sample as a fixture. Curl PDF + annotation JSON,
 * map via schema.yaml's docile: keys, write to evals/fixtures/docile_<id>/.
 */
const DOCILE_ID = '516f2d61ea404b30a9192a72';

async function main() {
  const fixtureId = `docile_${DOCILE_ID}`;
  const dir = path.join(REPO_ROOT, 'evals/fixtures', fixtureId);
  await mkdir(dir, { recursive: true });

  const pdfUrl = `https://raw.githubusercontent.com/rossumai/docile/main/tests/data/sample-dataset/pdfs/${DOCILE_ID}.pdf`;
  const annUrl = `https://raw.githubusercontent.com/rossumai/docile/main/tests/data/sample-dataset/annotations/${DOCILE_ID}.json`;

  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`pdf fetch ${pdfRes.status}`);
  await new Promise<void>((resolve, reject) => {
    const s = createWriteStream(path.join(dir, 'input.pdf'));
    s.on('finish', () => resolve());
    s.on('error', reject);
    pdfRes.body!.pipeTo(
      new WritableStream({
        write(chunk) {
          s.write(chunk);
        },
        close() {
          s.end();
        },
      }),
    );
  });

  const annRes = await fetch(annUrl);
  if (!annRes.ok) throw new Error(`annotation fetch ${annRes.status}`);
  const annotation = (await annRes.json()) as Parameters<typeof docileToExpected>[0];
  await writeFile(path.join(dir, 'source_annotation.json'), JSON.stringify(annotation, null, 2));

  const schema = await loadInvoiceSchemaFromDisk();
  const expected = docileToExpected(annotation, schema);
  await writeFile(path.join(dir, 'expected.yaml'), yamlStringify(expected));

  const meta = {
    source: 'docile',
    docile_id: DOCILE_ID,
    features: ['real-invoice', 'docile-sample'],
  };
  const readmePath = path.join(dir, 'metadata.yaml');
  await writeFile(readmePath, yamlStringify(meta));

  // eslint-disable-next-line no-console
  console.log(`imported ${fixtureId}`);
  const cachedAnn = await readFile(path.join(dir, 'source_annotation.json'), 'utf8').catch(() => null);
  if (!cachedAnn) throw new Error('failed to cache annotation');
}

void main();
