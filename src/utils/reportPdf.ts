import type { Entry, Timecode } from '../types';
import type { BillableLine } from './billing';
import { LOGO_PRINT_BASE64 } from '../assets/logoPrint';
import {
  buildDetailTable,
  buildSummaryTable,
  type ReportModel,
  type ReportSettings,
} from './reportDocument';

/**
 * The report PDF, as a Blob.
 *
 * Split out of the React handler so a PDF can be produced without a component
 * tree, which is what makes the fixture matrix reviewable: the review script
 * renders every fixture through this exact function, so what a reviewer opens
 * is the document the app ships rather than a reconstruction of it that can
 * drift from it. Everything here is positioning — the numbers arrive already
 * assembled from `reportDocument`.
 */
export interface ReportPdfInput {
  model: ReportModel;
  /** The entries the report shows, for the itemised table. */
  entries: Entry[];
  lines: Map<string, BillableLine>;
  timecodeMap: Map<string, Timecode>;
  settings: ReportSettings;
  /** The disclosure block, already assembled — see `buildReportMeta`. */
  meta: { label: string; value: string }[];
  /** Replaces the stored footer when the user typed one for this report. */
  footerTextOverride?: string;
}

export const renderReportPdf = async ({
  model: reportModel,
  entries: filteredEntries,
  lines: billableLines,
  timecodeMap,
  settings,
  meta,
  footerTextOverride,
}: ReportPdfInput): Promise<Blob> => {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // jsPDF decodes a PNG and re-embeds it as raw pixels unless told otherwise,
  // and this logo is 900x240 — 864KB of uncompressed bitmap on a one-page
  // invoice that is otherwise about 20KB. `alias` keeps it to a single copy
  // however many pages the header is drawn on.
  const drawTimeDocoLogo = (x: number, y: number, w: number, h: number) =>
    doc.addImage(LOGO_PRINT_BASE64, 'PNG', x, y, w, h, 'timedoco-logo', 'FAST');

  const drawHeader = () => {
    const userLogo = settings?.userLogoBase64;

    if (userLogo) {
      try {
        const props = doc.getImageProperties(userLogo);
        const maxW = 35, maxH = 12;
        const ratio = props.width / props.height;
        const w = ratio > maxW / maxH ? maxW : maxH * ratio;
        const h = ratio > maxW / maxH ? maxW / ratio : maxH;
        doc.addImage(userLogo, props.fileType, 14, 10, w, h, 'user-logo', 'MEDIUM');
      } catch (e) {
        console.error('Failed to render user logo in PDF, falling back to TimeDoco logo only:', e);
        drawTimeDocoLogo(14, 10, 37.5, 10);
      }
      drawTimeDocoLogo(pageWidth - 14 - 25, 8, 25, 6.67);
    } else {
      drawTimeDocoLogo(14, 10, 37.5, 10);
    }

    doc.setFontSize(9);
    doc.setTextColor(140);
    doc.text('Time & Activity Report', pageWidth - 14, userLogo ? 18 : 15, { align: 'right' });
  };

  let headerDrawnPage = 0;
  const ensureHeader = (pageNumber: number) => {
    if (pageNumber === headerDrawnPage) return;
    headerDrawnPage = pageNumber;
    drawHeader();
  };

  ensureHeader(1);

  let y = 28;
  // Assembled by the caller via `buildReportMeta`, from the same model the
  // tables are built from.
  const lines = meta;

  let labelColWidth = 0;
  let valueX = 40;

  if (lines.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const LABEL_COL_CAP = 65;
    const labelWidths = lines.map(l => doc.getTextWidth(l.label));
    labelColWidth = Math.min(Math.max(...labelWidths), LABEL_COL_CAP);
    valueX = 14 + labelColWidth + 3;
  }

  doc.setFontSize(10);
  doc.setTextColor(60);

  const metaLine = (label: string, value: string) => {
    if (!value) return;
    const labelLines = doc.splitTextToSize(label, labelColWidth);
    const valueLines = doc.splitTextToSize(value, pageWidth - 14 - valueX);
    doc.setFont('helvetica', 'bold');
    labelLines.forEach((l: string, i: number) => doc.text(l, 14, y + i * 5));
    doc.setFont('helvetica', 'normal');
    valueLines.forEach((l: string, i: number) => doc.text(l, valueX, y + i * 5));
    y += Math.max(labelLines.length, valueLines.length) * 5;
  };

  lines.forEach(l => metaLine(l.label, l.value));

  y += 3;
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary', 14, y);

  // head/body/foot come out of `reportDocument`, so the numbers a client
  // reads can be asserted without a PDF renderer. Everything here is layout.
  const summaryTable = buildSummaryTable(reportModel, settings);

  // Figures right-aligned, so the decimal points line up down the column. A
  // client checks an invoice by running an eye down it, and ragged left-aligned
  // decimals are the one thing that stops them.
  //
  // Through `didParseCell` rather than `columnStyles`, which autoTable applies
  // to body cells only: the total row is exactly the row that must line up with
  // the rows above it.
  const alignFigures = (firstFigureColumn: number) =>
    (data: { cell: { styles: { halign: string } }; column: { index: number } }) => {
      if (data.column.index >= firstFigureColumn) data.cell.styles.halign = 'right';
    };

  autoTable(doc, {
    startY: y + 4,
    head: summaryTable.head,
    body: summaryTable.body,
    foot: summaryTable.foot,
    footStyles: { fontStyle: 'bold', fillColor: [238, 240, 236], textColor: [16, 22, 28] },
    // From Rate onwards: the leading columns are names, the rest are figures.
    didParseCell: alignFigures(2),
    margin: { top: 25 },
    didDrawPage: () => ensureHeader((doc.internal as any).getNumberOfPages()),
  });

  const detailTable = buildDetailTable(filteredEntries, billableLines, timecodeMap, settings);

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 10,
    head: detailTable.head,
    body: detailTable.body,
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: { 7: { cellWidth: 60 } },
    // Hours and Amount, the two columns anyone adds up; the Note after them is
    // prose and stays left.
    didParseCell: (data) => {
      if (data.column.index === 5 || data.column.index === 6) data.cell.styles.halign = 'right';
    },
    margin: { top: 25 },
    didDrawPage: () => ensureHeader((doc.internal as any).getNumberOfPages()),
  });

  // A table that is nothing but a header row reads as a document that failed to
  // render. Say what it actually means.
  if (detailTable.body.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120);
    doc.text('No entries in this period.', 14, (doc as any).lastAutoTable.finalY + 6);
    doc.setFont('helvetica', 'normal');
  }

  const footerText = footerTextOverride || settings?.reportFooterText;
  if (footerText && footerText.trim()) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(footerText.trim(), pageWidth - 36);
    const lineHeight = 4;
    const boxPadding = 4;
    const blockHeight = lines.length * lineHeight + boxPadding * 2;
    const pageHeight = doc.internal.pageSize.getHeight();

    let currentY = (doc as any).lastAutoTable.finalY + 10;
    if (currentY + blockHeight > pageHeight - 20) {
      doc.addPage();
      currentY = 28;
      ensureHeader((doc.internal as any).getNumberOfPages());
    }

    doc.setFillColor(249, 245, 235);
    doc.rect(14, currentY, pageWidth - 28, blockHeight, 'F');
    doc.setTextColor(60);
    doc.text(lines, 18, currentY + boxPadding + 3);
  }

  const pageCount = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(160);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    doc.text('Generated with TimeDoco', 14, doc.internal.pageSize.getHeight() - 8);
  }

  return doc.output('blob');
};
