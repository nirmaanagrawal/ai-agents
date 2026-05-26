/**
 * File parsers for uploaded files.
 *
 * Supports CSV, XLSX/XLS, PDF, DOCX, TXT, and Markdown.
 *
 *   - PDF uses `pdf-parse` via its internal module
 *     (`pdf-parse/lib/pdf-parse.js`) to dodge the library's top-level
 *     debug hack — index.js reads a test fixture at import time
 *     (`./test/data/05-versions-space.pdf`) and ENOENTs on Vercel.
 *     Importing the inner module skips that probe.
 *   - DOCX uses `mammoth` — extracts plain text from Word documents,
 *     handles the most common JD / resume format.
 *   - TXT / MD are read as UTF-8 directly.
 *
 * PDF caveat: pdf-parse reads *text* layers only. Scanned-image PDFs
 * (no embedded text) come back near-empty — add OCR (Textract /
 * Tesseract) as a second pass if your visitors upload scans.
 */
import mammoth from 'mammoth';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- pdf-parse has no
// typed inner export; the root import fires a fixture read that ENOENTs serverless.
const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
  require('pdf-parse/lib/pdf-parse.js');
import type { ParsedInput } from './agents/types';

export async function parseFile(file: File): Promise<ParsedInput> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.csv') || file.type.includes('csv')) {
    return parseCsv(file.name, buffer);
  }

  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    file.type.includes('sheet') ||
    file.type.includes('excel')
  ) {
    return parseXlsx(file.name, buffer);
  }

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return parsePdf(file.name, buffer);
  }

  if (
    lower.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return parseDocx(file.name, buffer);
  }

  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    file.type === 'text/plain' ||
    file.type === 'text/markdown'
  ) {
    return parsePlainText(file.name, buffer);
  }

  throw new Error(
    `Unsupported file type: ${file.name}. Accepted: .csv, .xlsx, .xls, .pdf, .docx, .txt, .md`,
  );
}

function parseCsv(filename: string, buffer: Buffer): ParsedInput {
  // `header: true` turns each row into an object keyed by the header row —
  // much easier for the LLM to reason about than a flat 2D array.
  const result = Papa.parse<Record<string, string>>(buffer.toString('utf-8'), {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    // Don't hard-fail on minor CSV quirks (trailing commas, etc.); Papa's
    // partial parse is usually good enough for the LLM to work with.
    console.warn(`CSV parse warnings for ${filename}:`, result.errors.slice(0, 3));
  }

  return {
    filename,
    text: JSON.stringify(result.data, null, 2),
    metadata: {
      rowCount: result.data.length,
      columns: result.meta.fields ?? [],
    },
  };
}

/**
 * Extract text from a PDF. Returns the raw text layer plus page count.
 *
 * We collapse runs of whitespace because pdf-parse emits a lot of stray
 * spacing from column-based PDFs (invoices love these). The LLM doesn't
 * care about layout; it cares about tokens and readability.
 */
async function parsePdf(filename: string, buffer: Buffer): Promise<ParsedInput> {
  const result = await pdfParse(buffer);
  const text = result.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (!text) {
    // Most common cause: scanned-image PDF with no text layer.
    throw new Error(
      `${filename} has no extractable text. If it's a scanned image, run it through OCR first.`,
    );
  }

  return {
    filename,
    text,
    metadata: {
      pageCount: result.numpages,
      charCount: text.length,
    },
  };
}

/**
 * Extract plain text from a .docx via `mammoth`. JDs and resumes are
 * almost always Word docs in the wild; without this they'd be
 * rejected as "unsupported".
 */
async function parseDocx(filename: string, buffer: Buffer): Promise<ParsedInput> {
  const result = await mammoth.extractRawText({ buffer });
  // Mammoth returns the full text plus any conversion messages
  // (font fallbacks, unsupported elements). We discard the messages —
  // they're noise for our use case — but keep the warning count in
  // metadata so debugging is possible.
  const text = result.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    throw new Error(`${filename} has no extractable text.`);
  }
  return {
    filename,
    text,
    metadata: {
      charCount: text.length,
      docxWarnings: result.messages.length,
    },
  };
}

/**
 * Read a .txt / .md file as UTF-8. No transformation — the LLM
 * handles markdown structure fine without us pre-processing.
 */
function parsePlainText(filename: string, buffer: Buffer): ParsedInput {
  const text = buffer.toString('utf-8').trim();
  if (!text) {
    throw new Error(`${filename} is empty.`);
  }
  return {
    filename,
    text,
    metadata: { charCount: text.length },
  };
}

function parseXlsx(filename: string, buffer: Buffer): ParsedInput {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`${filename} has no sheets`);
  }

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  return {
    filename,
    text: JSON.stringify(data, null, 2),
    metadata: {
      rowCount: data.length,
      sheetName,
      allSheets: workbook.SheetNames,
    },
  };
}

/**
 * Truncate combined file text to stay under model input limits.
 *
 * GPT-4o-mini handles 128K input tokens, but we cap to ~12K chars (~3K tokens)
 * for two reasons:
 *   1. Cost — every token is billed, and most lead lists don't need more.
 *   2. Latency — shorter input means faster time-to-first-token.
 *
 * If your agent needs the full file, raise this cap or chunk the input and
 * call the model per chunk. Don't silently pass 1MB CSVs to the model.
 */
export function truncateForModel(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n[...truncated ${text.length - maxChars} characters — only the first ${maxChars} shown to the model]`
  );
}
