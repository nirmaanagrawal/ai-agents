/**
 * File-type → lucide icon + accent color mapping.
 *
 * Used by FileChip + Dropzone so attached files have a distinct visual
 * identity (red PDF, green spreadsheet, blue doc) instead of a generic
 * paperclip emoji. Subtle but reads as "this UI knows your file types."
 *
 * Colors are HSL Tailwind hues (`text-red-500` etc.) — they stay
 * legible in both light and dark mode. Avoid using hardcoded hex
 * here; let Tailwind's palette pick the shade.
 */
import {
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  type LucideIcon,
} from 'lucide-react';

export interface FileTypeMeta {
  /** Lucide icon component for this file kind. */
  Icon: LucideIcon;
  /** Tailwind text color class for the icon's accent tint. */
  color: string;
  /** Human label ("PDF", "Spreadsheet", "Document"). */
  label: string;
}

const PDF: FileTypeMeta = { Icon: FileText, color: 'text-red-500', label: 'PDF' };
const SPREADSHEET: FileTypeMeta = {
  Icon: FileSpreadsheet,
  color: 'text-emerald-500',
  label: 'Spreadsheet',
};
const DOCUMENT: FileTypeMeta = { Icon: FileText, color: 'text-blue-500', label: 'Document' };
const CODE: FileTypeMeta = { Icon: FileCode, color: 'text-violet-500', label: 'Code' };
const IMAGE: FileTypeMeta = { Icon: FileImage, color: 'text-amber-500', label: 'Image' };
const PLAIN: FileTypeMeta = { Icon: FileText, color: 'text-muted-foreground', label: 'Text' };
const UNKNOWN: FileTypeMeta = { Icon: FileIcon, color: 'text-muted-foreground', label: 'File' };

export function getFileTypeMeta(filename: string): FileTypeMeta {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'pdf':
      return PDF;
    case 'csv':
    case 'xlsx':
    case 'xls':
    case 'tsv':
      return SPREADSHEET;
    case 'docx':
    case 'doc':
    case 'rtf':
      return DOCUMENT;
    case 'txt':
    case 'md':
    case 'markdown':
      return PLAIN;
    case 'json':
    case 'xml':
    case 'yaml':
    case 'yml':
      return CODE;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return IMAGE;
    default:
      return UNKNOWN;
  }
}

/** Human-readable size — "234 KB", "1.2 MB", etc. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
