"use client";

import { useState, useRef } from "react";
import { ProcessingIndicator } from "./processing-indicator";

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type UploadStatus = "idle" | "uploading" | "processing" | "done" | "error";

/** Safely extract an error message from a fetch response (JSON or otherwise). */
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

function fileExtLabel(file: File): string {
  if (file.type === "application/pdf") return "PDF";
  const ext = file.type.split("/")[1]?.toUpperCase();
  return ext || "FILE";
}

export function UploadStep({
  clientId,
  onProcessing,
  onDraftReady,
}: {
  clientId: string;
  onProcessing?: () => void;
  onDraftReady: (uploadId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const isPdf = file?.type === "application/pdf";
  const isImage = file?.type.startsWith("image/") ?? false;

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
      // Don't clear the file — keep previous selection if any
      return;
    }
    setError(null);
    setFile(f);
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
    setUploadId(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function pollStatus(id: string) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/mealplans/uploads?clientId=${clientId}`);
        if (!res.ok) return;
        const data = await res.json();
        const upload = data.uploads?.find(
          (u: { id: string }) => u.id === id
        );
        if (!upload) return;

        if (upload.status === "NEEDS_REVIEW") {
          stopPolling();
          setStatus("done");
          onDraftReady(id);
        } else if (upload.status === "FAILED") {
          stopPolling();
          setStatus("error");
          setError(upload.errorMessage || "Processing failed. Try again.");
        }
      } catch {
        // Polling error — keep trying
      }
    }, 2000);
  }

  async function handleUploadAndProcess() {
    if (!file) return;
    setError(null);
    setStatus("uploading");

    try {
      // 1. Get signed upload URL
      const urlRes = await fetch("/api/mealplans/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          filename: file.name,
          mimeType: file.type,
        }),
      });

      if (!urlRes.ok) {
        throw new Error(await extractError(urlRes, "Failed to get upload URL"));
      }

      const urlData = await urlRes.json();
      const id = urlData.uploadId;
      const signedUrl = urlData.signedUrl;
      setUploadId(id);

      // 2. Upload file directly to Supabase
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "x-upsert": "true",
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(await extractError(uploadRes, "File upload to storage failed"));
      }

      // 3. Trigger parse
      setStatus("processing");
      onProcessing?.();

      const parseRes = await fetch("/api/mealplans/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id }),
      });

      // Read parse response once
      const parseText = await parseRes.text();
      let parseData: { status?: string; error?: string } = {};
      try {
        parseData = JSON.parse(parseText);
      } catch {
        if (!parseRes.ok) {
          throw new Error(`Processing failed (${parseRes.status} ${parseRes.statusText})`);
        }
      }

      if (!parseRes.ok) {
        throw new Error(parseData.error || "Processing failed");
      }

      if (parseData.status === "needs_review") {
        setStatus("done");
        onDraftReady(id);
      } else {
        // Still processing or unknown — poll
        pollStatus(id);
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function handleRetry() {
    if (!uploadId) return;
    setError(null);
    setStatus("processing");

    try {
      const parseRes = await fetch("/api/mealplans/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });

      // Read response once, safely
      const parseText = await parseRes.text();
      let parseData: { status?: string; error?: string } = {};
      try {
        parseData = JSON.parse(parseText);
      } catch {
        throw new Error(`Retry failed (${parseRes.status} ${parseRes.statusText})`);
      }

      if (parseData.status === "needs_review") {
        setStatus("done");
        onDraftReady(uploadId);
      } else if (parseData.status === "failed" || !parseRes.ok) {
        setStatus("error");
        setError(parseData.error || "Processing failed");
      } else {
        pollStatus(uploadId);
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  const isProcessing = status === "uploading" || status === "processing";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Import Meal Plan</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a photo or PDF of a meal plan. We&apos;ll extract the foods and
          portions so you can review before importing.
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
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
          }}
          disabled={isProcessing}
        />

        {file ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            {/* File type badge */}
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                  isPdf
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                }`}
              >
                {fileExtLabel(file)}
              </span>
              {isImage && (
                <span className="text-xs text-zinc-400">Image</span>
              )}
            </div>

            {/* Filename */}
            <p className="max-w-xs truncate text-sm font-medium">{file.name}</p>

            {/* Metadata */}
            <p className="text-xs text-zinc-400">
              {formatFileSize(file.size)}
            </p>

            {/* Clear button (only when idle or error — not during processing) */}
            {!isProcessing && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
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
            <p className="text-sm font-medium">
              Drop file here or click to browse
            </p>
            <p className="text-xs text-zinc-400">
              PNG, JPG, WEBP, or PDF &middot; Max 10 MB
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/50"
        >
          <p className="font-medium text-red-700 dark:text-red-400">
            {error.includes("bucket") || error.includes("Bucket") || error.includes("storage")
              ? "Storage is not configured."
              : error.includes("No text detected")
                ? "Could not read text from file."
                : error.includes("billing") || error.includes("BILLING")
                  ? "OCR service is not configured."
                  : "Processing failed"}
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400/80">
            {error}
          </p>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <ProcessingIndicator mode={status === "uploading" ? "upload" : "upload"} />
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {status === "error" && uploadId && (
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Retry Processing
          </button>
        )}

        <button
          type="button"
          onClick={handleUploadAndProcess}
          disabled={!file || isProcessing}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {isProcessing ? "Processing..." : "Upload & Process"}
        </button>
      </div>
    </div>
  );
}
