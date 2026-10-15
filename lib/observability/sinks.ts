import type { ObservabilityEvent } from "@/lib/observability/report";

/**
 * The single extension point for T-924 (Sentry). That ticket edits this file
 * and nothing else: appends a sink to the array `activeSinks()` returns.
 * Nothing in T-920 knows Sentry exists.
 */
export interface Sink {
  name: string;
  emit(event: ObservabilityEvent): void;
}

/** Writes exactly one line of JSON to `console.error`, prefixed by the `sf.`
 *  `evt` value already on the event so every line is greppable. */
export const consoleSink: Sink = {
  name: "console",
  emit(event) {
    console.error(JSON.stringify(event));
  },
};

export function activeSinks(): Sink[] {
  return [consoleSink];
}
