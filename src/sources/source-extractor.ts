import { extname } from 'node:path';

import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

import { MAX_EXTRACTED_CHARACTERS, MAX_SOURCE_BYTES } from './source.schema';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml']);

export class UnsupportedSourceTypeError extends Error {
  constructor() {
    super('Unsupported source type. Use PDF, DOCX, Markdown, text, CSV, JSON, or YAML.');
    this.name = 'UnsupportedSourceTypeError';
  }
}

function normalizedExtension(name: string): string {
  return extname(name).toLowerCase();
}

export function validateSourceContent(input: { name: string; mimeType: string; content: Buffer }): void {
  if (input.content.byteLength < 1) throw new Error('Source content is empty');
  if (input.content.byteLength > MAX_SOURCE_BYTES) throw new Error('Source exceeds the 10 MB source limit');
  if (input.name.includes('\0')) throw new Error('Source name is invalid');
  const extension = normalizedExtension(input.name);
  const supported = input.mimeType === 'application/pdf'
    || input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || input.mimeType.startsWith('text/')
    || TEXT_EXTENSIONS.has(extension)
    || extension === '.pdf'
    || extension === '.docx';
  if (!supported) throw new UnsupportedSourceTypeError();
}

export async function extractSourceText(input: { name: string; mimeType: string; content: Buffer }): Promise<string> {
  validateSourceContent(input);
  const extension = normalizedExtension(input.name);
  let text: string;
  if (input.mimeType === 'application/pdf' || extension === '.pdf') {
    const document = await getDocumentProxy(new Uint8Array(input.content));
    try {
      text = (await extractPdfText(document, { mergePages: true })).text;
    } finally {
      await document.destroy();
    }
  } else if (input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || extension === '.docx') {
    text = (await mammoth.extractRawText({ buffer: input.content })).value;
  } else {
    text = input.content.toString('utf8');
  }
  const normalized = text.trim();
  if (normalized.length === 0) throw new Error('No readable text was found in the source');
  return normalized.slice(0, MAX_EXTRACTED_CHARACTERS);
}
