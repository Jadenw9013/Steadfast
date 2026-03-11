"use client";

import { useState, useRef } from "react";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type UploadStatus = "idle" | "uploading" | "processing" | "done" | "error";

async function extractError(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
    const json = JSON.parse(text);
    return json.error || json.message || fallback;
  } catch {
    return `${fallback} (${res.status} ${res.statusText})`;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function WorkoutUploadStep({
  onProcessing,
  onDraftReady,
  clientId,
}: {
  onProcessing?: () => void;
  onDraftReady: (importId: string) => void;
  clientId?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateFile(f: File): string | null {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return "Unsupported file type. Use PNG, JPG, WEBP, or PDF.";
    }
    if (f.size > MAX_FILE_SIZE) {
      return `File too large (${formatFileSize(f.size)}). Max: 10 MB.`;
    }
    return null;
  }

  function handleFileSelect(f: File) {
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    setStatus("idle");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }

  function clearFile() {
    setFile(null);
    setError(null);
    setStatus("idle");
    setImportId(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleRetry() {
    if (!importId) return;
    setError(null);
    setStatus("processing");

    try {
      const parseRes = await fetch("/api/workout-import/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId }),
      });
      const parseText = await parseRes.text();
      let parseData: { status?: string; error?: string } = {};
      try { parseData = JSON.parse(parseText); } catch { /* ignore */ }

      if (parseData.status === "needs_review") {
        setStatus("done");
        onDraftReady(importId);
      } else {
        setStatus("error");
        setError(parseData.error || "Processing failed");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  async function handleUploadAndProcess() {
    if (!file) return;
    setError(null);
    setStatus("uploading");

    try {
      // 1. Get signed upload URL
      const urlRes = await fetch("/api/workout-import/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, clientId }),
      });
      if (!urlRes.ok) throw new Error(await extractError(urlRes, "Failed to get upload URL"));

      const urlData = await urlRes.json();
      const id = urlData.importId;
      const signedUrl = urlData.signedUrl;
      setImportId(id);

      // 2. Upload directly to Supabase
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-upsert": "true" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(await extractError(uploadRes, "File upload failed"));

      // 3. Trigger parse (OCR + LLM)
      setStatus("processing");
      onProcessing?.();

      const parseRes = await fetch("/api/workout-import/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId: id }),
      });
      const parseText = await parseRes.text();
      let parseData: { status?: string; error?: string } = {};
      try { parseData = JSON.parse(parseText); } catch {
        if (!parseRes.ok) throw new Error(`Processing failed (${parseRes.status})`);
      }
      if (!parseRes.ok) throw new Error(parseData.error || "Processing failed");

      if (parseData.status === "needs_review") {
        setStatus("done");
        onDraftReady(id);
      } else {
        setStatus("error");
        setError(parseData.error || "Processing failed");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const isProcessing = status === "uploading" || status === "processing";
  const isPdf = file?.type === "application/pdf";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Upload Workout Plan</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a PDF or image of a workout program. We&apos;ll extract and
          structure it for you to review.
        </p>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop file here or click to browse"
        className={`relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
          dragOver
            ? "border-zinc-500 bg-zinc-100 dark:bg-zinc-800"
            : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        } ${isProcessing ? "pointer-events-none opacity-60" : ""}`}
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
      >
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
          disabled={isProcessing}
        />

        {file ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                isPdf
                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
              }`}
            >
              {isPdf ? "PDF" : file.type.split("/")[1]?.toUpperCase() ?? "FILE"}
            </span>
            <p className="max-w-xs truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-zinc-400">{formatFileSize(file.size)}</p>
            {!isProcessing && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); clearFile(); }}
                className="mt-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                Choose a different file
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-xl dark:bg-zinc-800">
              &#128196;
            </div>
            <p className="text-sm font-medium">Drop file here or click to browse</p>
            <p className="text-xs text-zinc-400">PNG, JPG, WEBP, or PDF &middot; Max 10 MB</p>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/50"
        >
          <p className="font-medium text-red-700 dark:text-red-400">
            {error.includes("bucket") || error.includes("storage")
              ? "Storage is not configured."
              : error.includes("No text detected")
                ? "Could not read text from file."
                : error.includes("billing") || error.includes("BILLING")
                  ? "OCR service is not configured."
                  : "Processing failed"}
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400/80">{error}</p>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {status === "uploading" ? "Uploading file…" : "Reading and parsing workout program…"}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        {status === "error" && importId && (
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={handleUploadAndProcess}
          disabled={!file || isProcessing}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {isProcessing ? "Processing…" : "Upload & Parse"}
        </button>
      </div>
    </div>
  );
}
