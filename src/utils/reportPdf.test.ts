import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIXTURES, renderFixture, fixtureSlug, type Fixture } from '../test/reportFixtures';
import { renderReportPdf } from './reportPdf';

/**
 * Every fixture in the document matrix, rendered as an actual PDF.
 *
 * Two jobs. The standing one is coverage the PDF path had none of: an empty
 * report, a fee-only row, a note long enough to wrap, a user logo, a report
 * with no rates — each of those is a layout branch, and nothing checked that
 * any of them survived contact with jsPDF at all.
 *
 * The second is the launch gate. Pagination, column widths and how a long note
 * lands are not things a unit test can judge, and nobody has looked at the
 * output. Run with RENDER_REVIEW_PDFS=1 and every fixture is written to
 * `pdf-review/`, through the same function the app calls — so what gets looked
 * at is the document a client would receive, not a reconstruction of it.
 *
 *   RENDER_REVIEW_PDFS=1 npx vitest run --project utc src/utils/reportPdf.test.ts
 */

const OUT_DIR = resolve(process.cwd(), 'pdf-review');
const writeForReview = process.env.RENDER_REVIEW_PDFS === '1';

// A 1x1 PNG, so the logo branch of the header is exercised.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('report PDF', () => {
  if (writeForReview) mkdirSync(OUT_DIR, { recursive: true });

  describe.each(FIXTURES.map((f: Fixture) => [f.name, f] as [string, Fixture]))('%s', (name, fixture) => {
    it('renders a PDF', async () => {
      const out = renderFixture(fixture);
      const blob = await renderReportPdf({
        model: out.model,
        entries: out.entries,
        lines: out.lines,
        timecodeMap: out.timecodeMap,
        settings: out.settings,
        meta: out.meta,
      });

      // A jsPDF that threw would have rejected; a blank one is the quieter
      // failure, so check there is a document's worth of bytes in it.
      expect(blob.size).toBeGreaterThan(2000);

      if (writeForReview) {
        const bytes = Buffer.from(await blob.arrayBuffer());
        writeFileSync(resolve(OUT_DIR, `${fixtureSlug(name)}.pdf`), bytes);
      }
    });
  });

  it('renders with a user logo in the header', async () => {
    const fixture = FIXTURES.find((f: Fixture) => f.name === 'fees alongside hourly work')!;
    const out = renderFixture({
      ...fixture,
      settings: { ...fixture.settings, userLogoBase64: TINY_PNG },
    });

    const blob = await renderReportPdf({
      model: out.model,
      entries: out.entries,
      lines: out.lines,
      timecodeMap: out.timecodeMap,
      settings: out.settings,
      meta: out.meta,
      footerTextOverride: 'Payment due within 30 days. Bank: 00-0000-0000000-00.',
    });

    expect(blob.size).toBeGreaterThan(2000);
    if (writeForReview) {
      writeFileSync(
        resolve(OUT_DIR, 'with-logo-and-footer.pdf'),
        Buffer.from(await blob.arrayBuffer()),
      );
    }
  });

  it('survives a logo the renderer cannot decode', async () => {
    // Falls back to the TimeDoco logo alone rather than failing the export —
    // a user whose stored logo is corrupt still gets their invoice.
    const fixture = FIXTURES.find((f: Fixture) => f.name === 'plain hourly report')!;
    const out = renderFixture({
      ...fixture,
      settings: { ...fixture.settings, userLogoBase64: 'data:image/png;base64,not-an-image' },
    });

    const blob = await renderReportPdf({
      model: out.model,
      entries: out.entries,
      lines: out.lines,
      timecodeMap: out.timecodeMap,
      settings: out.settings,
      meta: out.meta,
    });
    expect(blob.size).toBeGreaterThan(2000);
  });

  it('does not embed the logo as an uncompressed bitmap', async () => {
    // jsPDF re-encodes a PNG as raw pixels unless given a compression level,
    // and this logo is 900x240 — that put 864KB of bitmap into every export,
    // on a one-page invoice whose text is about 20KB. An emailed invoice
    // should not be most of a megabyte of header image.
    const out = renderFixture(FIXTURES.find((f: Fixture) => f.name === 'plain hourly report')!);
    const blob = await renderReportPdf({
      model: out.model,
      entries: out.entries,
      lines: out.lines,
      timecodeMap: out.timecodeMap,
      settings: out.settings,
      meta: out.meta,
    });

    expect(blob.size).toBeLessThan(120_000);
  });

  it('paginates a report long enough to run past one page', async () => {
    const fixture = FIXTURES.find((f: Fixture) => f.name === 'plain hourly report')!;
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...fixture.entries[0],
      id: `bulk-${i}`,
      startTime: new Date(2026, 0, 5 + (i % 7), 8 + (i % 10), (i * 7) % 60).toISOString(),
      endTime: new Date(2026, 0, 5 + (i % 7), 8 + (i % 10), ((i * 7) % 60) + 20).toISOString(),
      note: `Entry ${i} — a note long enough to wrap across the column and push the row taller than one line.`,
    }));
    const out = renderFixture({ ...fixture, entries: many });

    const blob = await renderReportPdf({
      model: out.model,
      entries: out.entries,
      lines: out.lines,
      timecodeMap: out.timecodeMap,
      settings: out.settings,
      meta: out.meta,
    });

    expect(blob.size).toBeGreaterThan(10000);
    // The header is drawn on every page, but the logo is aliased, so it is
    // embedded once however long the report runs.
    expect(blob.size).toBeLessThan(400_000);
    if (writeForReview) {
      writeFileSync(
        resolve(OUT_DIR, 'multi-page.pdf'),
        Buffer.from(await blob.arrayBuffer()),
      );
    }
  });
});
