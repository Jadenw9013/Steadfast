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
      <p className="text-sm font-medium text-zinc-300">
        {files.length}/{maxFiles} photos
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-900/50 bg-red-950/50 px-4 py-2.5 text-sm text-red-400"
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
                className="aspect-square w-full rounded-xl border border-white/10 object-cover"
              />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white shadow-md transition-all hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
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
              ? "border-blue-500/50 bg-blue-500/5"
              : "border-white/15 hover:border-white/25"
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
          <p className="text-sm font-medium text-zinc-300">
            {files.length === 0
              ? "Tap to add photos"
              : `Add ${maxFiles - files.length} more`}
          </p>
          <p className="text-xs text-zinc-500">JPEG, PNG, or WebP &middot; 5 MB max</p>
        </div>
      )}
    </div>
  );
}
