/** Bound actual streamed bytes, including requests without Content-Length. */
export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("Request too large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readBoundedJson(request: Request, limit: number) {
  try {
    const bytes = await readBoundedBody(request, limit);
    return { ok: true as const, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request too large";
    return { ok: false as const, status: tooLarge ? 413 : 400, error: tooLarge ? "Request too large" : "Invalid JSON body" };
  }
}
