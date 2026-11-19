function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function comparable(signature: string) {
  try {
    return JSON.stringify(canonical(JSON.parse(signature)));
  } catch {
    return signature;
  }
}

export function publicationState(current: string, published: string | null) {
  const matchesPublished = published !== null && comparable(current) === comparable(published);
  return {
    matchesPublished,
    canPublish: !matchesPublished,
    message: matchesPublished
      ? "Published · This matches the plan shared with your client."
      : published === null
        ? "Not published · Your client cannot see these changes yet."
        : "Unpublished changes · Your client still sees the published version.",
  };
}
