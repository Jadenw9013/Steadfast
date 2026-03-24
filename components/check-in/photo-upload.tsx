"use client";

import { useRef, useState } from "react";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface PhotoUploadProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  maxFiles?: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoUpload({
  files,
  onFilesChange,
  maxFiles = 10,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function validateAndAdd(selected: File[]) {
    setError(null);

    for (const file of selected) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(`"${file.name}" is not supported. Use JPEG, PNG, or WebP.`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" exceeds the 5 MB limit (${formatSize(file.size)}).`);
        return;
      }
    }

    const combined = [...files, ...selected].slice(0, maxFiles);
    onFilesChange(combined);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    validateAndAdd(selected);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const selected = Array.from(e.dataTransfer.files);
    validateAndAdd(selected);
  }

  function removeFile(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  const canAddMore = files.length < maxFiles;

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        Progress pics <span className="text-gray-400 dark:text-zinc-500">({files.length}/{maxFiles})</span>
      </label>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Thumbnail grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {files.map((file, i) => (
            <div key={i} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt={`Preview ${i + 1}`}
                className="aspect-square w-full rounded-xl border border-zinc-200 object-cover dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white shadow-md transition-all hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-blue-600 dark:text-white dark:hover:bg-red-500 dark:hover:text-white"
                aria-label={`Remove photo ${i + 1}`}
              >
                &times;
              </button>
              <p className="mt-1 truncate text-[10px] text-zinc-400">{formatSize(file.size)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Dropzone */}
      {canAddMore && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${dragOver
              ? "border-zinc-500 bg-zinc-100 dark:bg-zinc-800"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
            }`}
          aria-label="Drop photos here or click to browse"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleChange}
            className="sr-only"
          />
          <p className="text-sm font-medium text-zinc-500">
            {files.length === 0
              ? "Drop photos here or tap to browse"
              : `Add ${maxFiles - files.length} more`}
          </p>
          <p className="text-xs text-zinc-400">JPEG, PNG, or WebP &middot; Max 5 MB each</p>
        </div>
      )}
    </div>
  );
}
