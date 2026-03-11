/**
 * Browser clipboard utilities for copying and pasting plan sections.
 * Data is serialized as JSON with a `_steadfast` marker for validation.
 */

export type ClipboardSectionType = "supplements" | "override" | "rules" | "allowances";

interface ClipboardPayload {
  _steadfast: true;
  type: ClipboardSectionType;
  data: unknown;
  copiedAt: string;
}

/**
 * Copy a plan section to the browser clipboard.
 */
export async function copySection(type: ClipboardSectionType, data: unknown): Promise<boolean> {
  try {
    const payload: ClipboardPayload = {
      _steadfast: true,
      type,
      data,
      copiedAt: new Date().toISOString(),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload));
    return true;
  } catch {
    // Fallback: try using a hidden textarea
    try {
      const el = document.createElement("textarea");
      el.value = JSON.stringify({ _steadfast: true, type, data, copiedAt: new Date().toISOString() });
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Paste a plan section from the browser clipboard.
 * Returns the data if it matches the expected type, otherwise null.
 */
export async function pasteSection<T>(expectedType: ClipboardSectionType): Promise<T | null> {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text) as ClipboardPayload;

    if (!parsed._steadfast || parsed.type !== expectedType) {
      return null;
    }

    return parsed.data as T;
  } catch {
    return null;
  }
}

/**
 * Check if clipboard contains a valid section of the expected type.
 */
export async function hasClipboardSection(expectedType: ClipboardSectionType): Promise<boolean> {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text) as ClipboardPayload;
    return parsed._steadfast === true && parsed.type === expectedType;
  } catch {
    return false;
  }
}
