import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureStorageDirs } from '../core/config.ts';

export type FileCategory = 'xray' | 'mri' | 'blood';

export interface ValidatedUpload {
  safeOriginalName: string;
  storedFilename: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  sha256Hash: string;
}

const ALLOWED_MIME_BY_CATEGORY: Record<FileCategory, string[]> = {
  xray: ['image/jpeg', 'image/png'],
  mri: ['image/jpeg', 'image/png'],
  blood: ['application/pdf', 'image/jpeg', 'image/png'],
};

const ALLOWED_EXT_BY_CATEGORY: Record<FileCategory, string[]> = {
  xray: ['.jpg', '.jpeg', '.png'],
  mri: ['.jpg', '.jpeg', '.png'],
  blood: ['.pdf', '.jpg', '.jpeg', '.png'],
};

export function detectMagicMime(buffer: Buffer): string | null {
  if (buffer.length < 5) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // PDF: %PDF-
  const pdfMagic = buffer.subarray(0, 5).toString('ascii');
  if (pdfMagic === '%PDF-') {
    return 'application/pdf';
  }

  return null;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'medical_document';
}

export function validateAndStoreBuffer(params: {
  buffer: Buffer;
  originalName: string;
  declaredMime: string;
  category: FileCategory;
  userId: string;
}): ValidatedUpload {
  const { buffer, originalName, declaredMime, category, userId } = params;

  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (buffer.length > config.maxUploadBytes) {
    throw new Error(`File exceeds the maximum allowed size of ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`);
  }

  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXT_BY_CATEGORY[category].includes(ext)) {
    throw new Error(
      category === 'blood'
        ? 'Blood reports must be PDF, JPG, JPEG, or PNG files.'
        : `${category.toUpperCase()} scans must be JPG, JPEG, or PNG image files.`
    );
  }

  const magicMime = detectMagicMime(buffer);
  if (!magicMime) {
    throw new Error('File signature verification failed. The file appears corrupted or unsupported.');
  }

  if (!ALLOWED_MIME_BY_CATEGORY[category].includes(magicMime)) {
    throw new Error(`File signature (${magicMime}) is not supported for ${category.toUpperCase()} analysis.`);
  }

  // Ensure declared MIME isn't wildly inconsistent (e.g. executable disguised)
  const normalizedDeclared = declaredMime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : declaredMime.toLowerCase();
  if (normalizedDeclared && normalizedDeclared !== 'application/octet-stream' && normalizedDeclared !== magicMime) {
    throw new Error('Declared file MIME type does not match actual file contents.');
  }

  // Basic script/payload scan inside image headers or suspicious PDF active exploit markers
  if (magicMime === 'application/pdf') {
    const headSample = buffer.subarray(0, Math.min(buffer.length, 65536)).toString('latin1');
    if (/\/Launch\b|\/RichMedia\b/i.test(headSample)) {
      throw new Error('Uploaded PDF contains disallowed active embedded actions.');
    }
  }

  ensureStorageDirs();
  const userDir = path.join(config.privateStorageDir, userId);
  fs.mkdirSync(userDir, { recursive: true });

  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const storedExt = magicMime === 'application/pdf' ? '.pdf' : magicMime === 'image/png' ? '.png' : '.jpg';
  const storedFilename = `${crypto.randomUUID()}${storedExt}`;
  const storagePath = path.join(userDir, storedFilename);

  fs.writeFileSync(storagePath, buffer, { mode: 0o600 });

  return {
    safeOriginalName: sanitizeFilename(originalName),
    storedFilename,
    storagePath,
    mimeType: magicMime,
    fileSize: buffer.length,
    sha256Hash,
  };
}

export function deletePrivateFile(storagePath: string): void {
  try {
    const resolved = path.resolve(storagePath);
    if (resolved.startsWith(path.resolve(config.privateStorageDir)) && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch {
    // Ignore cleanup errors
  }
}
