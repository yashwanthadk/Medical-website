import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router, type Response } from 'express';
import multer from 'multer';
import { config } from '../core/config.ts';
import { getDb } from '../core/database.ts';
import {
  asyncHandler,
  DEFAULT_WORKSPACE_ID,
  logAudit,
  signFileAccessToken,
  verifyFileAccessToken,
  type WorkspaceRequest,
} from '../core/security.ts';
import {
  deletePrivateFile,
  validateAndStoreBuffer,
  type FileCategory,
} from '../services/fileValidation.ts';

export const uploadsRouter = Router();

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
  },
});

function handleMulterUpload(req: WorkspaceRequest, res: Response, next: () => void): void {
  uploadMiddleware.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: `File exceeds the maximum allowed size of ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`,
        });
        return;
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid file upload request.',
      });
      return;
    }
    next();
  });
}

// POST /api/v1/uploads
uploadsRouter.post(
  '/',
  handleMulterUpload,
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const category = String(req.body?.category || '').toLowerCase() as FileCategory;

    if (!['xray', 'mri', 'blood'].includes(category)) {
      res.status(400).json({ error: 'Invalid upload category. Expected xray, mri, or blood.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Please select a file to upload.' });
      return;
    }

    let validated;
    try {
      validated = validateAndStoreBuffer({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        category,
        userId: workspaceId,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to validate uploaded file.',
      });
      return;
    }

    const db = await getDb();
    const existingDup = await db.queryOne<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM uploaded_files
       WHERE user_id = ? AND sha256_hash = ? AND file_category = ?
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId, validated.sha256Hash, category]
    );

    const fileId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO uploaded_files (
        id, user_id, report_id, original_filename, stored_filename, storage_path,
        mime_type, file_size, sha256_hash, file_category, file_data, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileId,
        workspaceId,
        validated.safeOriginalName,
        validated.storedFilename,
        validated.storagePath,
        validated.mimeType,
        validated.fileSize,
        validated.sha256Hash,
        category,
        validated.fileBuffer,
        now,
      ]
    );

    const previewToken = signFileAccessToken(fileId, workspaceId, 86400);

    await logAudit({
      userId: workspaceId,
      requestId: req.requestId || 'req',
      action: 'FILE_UPLOADED',
      resourceType: 'uploaded_file',
      resourceId: fileId,
      statusCode: 201,
      ipAddress: req.ip,
    });

    res.status(201).json({
      fileId,
      originalFilename: validated.safeOriginalName,
      mimeType: validated.mimeType,
      fileSize: validated.fileSize,
      category,
      isDuplicate: Boolean(existingDup),
      duplicateOfFileId: existingDup?.id ?? null,
      signedPreviewUrl: `/api/v1/uploads/${fileId}?token=${encodeURIComponent(previewToken)}`,
      createdAt: now,
    });
  })
);

// GET /api/v1/uploads/:fileId (Protected via signed preview token OR matching workspace header)
uploadsRouter.get(
  '/:fileId',
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const fileId = String(req.params.fileId || '');
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const db = await getDb();

    const fileRow = await db.queryOne<{
      id: string;
      user_id: string;
      original_filename: string;
      storage_path: string;
      mime_type: string;
      file_data: Buffer | Uint8Array | null;
    }>(
      'SELECT id, user_id, original_filename, storage_path, mime_type, file_data FROM uploaded_files WHERE id = ?',
      [fileId]
    );

    if (!fileRow) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    let authorized = false;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    if (queryToken && verifyFileAccessToken(queryToken, fileRow.id, fileRow.user_id)) {
      authorized = true;
    } else if (workspaceId === fileRow.user_id) {
      authorized = true;
    }

    if (!authorized) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this medical file.' });
      return;
    }

    res.setHeader('Content-Type', fileRow.mime_type);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `inline; filename="${fileRow.original_filename}"`);

    if (fileRow.storage_path && fs.existsSync(fileRow.storage_path)) {
      fs.createReadStream(fileRow.storage_path).pipe(res);
      return;
    }

    if (fileRow.file_data) {
      const buf = Buffer.isBuffer(fileRow.file_data)
        ? fileRow.file_data
        : Buffer.from(fileRow.file_data);
      res.setHeader('Content-Length', String(buf.length));
      res.send(buf);
      return;
    }

    res.status(404).json({ error: 'Stored file could not be located.' });
  })
);

// DELETE /api/v1/uploads/:fileId
uploadsRouter.delete(
  '/:fileId',
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const fileId = String(req.params.fileId || '');
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const db = await getDb();

    const fileRow = await db.queryOne<{ id: string; user_id: string; storage_path: string }>(
      'SELECT id, user_id, storage_path FROM uploaded_files WHERE id = ?',
      [fileId]
    );

    if (!fileRow) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    if (fileRow.user_id !== workspaceId) {
      res.status(403).json({ error: 'Forbidden: you cannot delete another workspace’s file.' });
      return;
    }

    deletePrivateFile(fileRow.storage_path);
    await db.execute('DELETE FROM uploaded_files WHERE id = ? AND user_id = ?', [
      fileId,
      workspaceId,
    ]);

    await logAudit({
      userId: workspaceId,
      requestId: req.requestId || 'req',
      action: 'FILE_DELETED',
      resourceType: 'uploaded_file',
      resourceId: fileId,
      statusCode: 200,
      ipAddress: req.ip,
    });

    res.json({ message: 'File deleted securely.' });
  })
);
