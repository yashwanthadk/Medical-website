import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Image as ImageIcon, UploadCloud, X } from 'lucide-react';

interface DropzoneUploaderProps {
  accept: string;
  acceptedExtensionsLabel: string;
  maxMb?: number;
  selectedFile: File | null;
  onFileSelected: (file: File | null) => void;
  uploadProgress: number | null;
  isUploading: boolean;
  duplicateWarning?: boolean;
  errorMessage?: string | null;
}

export function DropzoneUploader({
  accept,
  acceptedExtensionsLabel,
  maxMb = 20,
  selectedFile,
  onFileSelected,
  uploadProgress,
  isUploading,
  duplicateWarning,
  errorMessage,
}: DropzoneUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFile = (file: File | null) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (file && file.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(file));
    }
    onFileSelected(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (isUploading) return;
    const file = e.dataTransfer.files?.[0] || null;
    if (file) handleFile(file);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => !isUploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors cursor-pointer ${
          dragActive
            ? 'border-sky-600 bg-sky-50/70'
            : 'border-slate-300 bg-white hover:border-sky-500 hover:bg-slate-50/60'
        } ${isUploading ? 'opacity-70 cursor-not-allowed' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            handleFile(file);
          }}
        />

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-sky-700 border border-sky-200/80">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-900">
          Drag and drop your medical file here, or click to browse
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Supported formats: {acceptedExtensionsLabel} · Maximum size {maxMb} MB · Private encrypted upload
        </p>
      </div>

      {selectedFile && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 min-w-0">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={selectedFile.name}
                className="h-14 w-14 rounded-lg object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                {selectedFile.type === 'application/pdf' ? (
                  <FileText className="h-6 w-6 text-sky-700" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-sky-700" />
                )}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{selectedFile.name}</p>
              <p className="text-xs text-slate-500 tabular-nums">
                {formatBytes(selectedFile.size)} · {selectedFile.type || 'Medical document'}
              </p>
            </div>
          </div>

          {!isUploading && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (inputRef.current) inputRef.current.value = '';
                handleFile(null);
              }}
              aria-label="Remove selected file"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {uploadProgress !== null && isUploading && (
        <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-700">
            <span>Uploading securely to private storage...</span>
            <span className="font-mono tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-sky-700 transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {duplicateWarning && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
          <CheckCircle2 className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <p>
            Duplicate notice: an identical file checksum already exists in your history. A fresh
            analysis record is being processed for you.
          </p>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900">
          <AlertCircle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
          <p>{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
