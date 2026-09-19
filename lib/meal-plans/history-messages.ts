/**
 * T-801 (review round 1, finding 4) — the two restore-related user-facing
 * sentences, in a module with zero imports and specifically NOT importing
 * `@/lib/db`. `lib/meal-plans/history.ts` pulls in `@/lib/db` at module
 * scope, so a `"use client"` component (`RestoreVersionButton`) cannot import
 * from it; before this module existed the button hardcoded a second copy of
 * `sourceNotRestorableMessage()`'s wording, which is exactly the drift
 * standing rule 1 exists to prevent.
 *
 * `lib/meal-plans/history.ts` re-exports both from here rather than
 * redefining them, so every one of the three transports (REST route, Server
 * Action, and the confirm button) reads the same one copy. Both are well
 * under the 300-char cutoff in iOS `userFacingErrorMessage`
 * (`APIService.swift`), which returns the `error` key verbatim.
 */
export function sourceNotRestorableMessage(): string {
  return "Only published plan versions can be restored.";
}

export function draftExistsMessage(): string {
  return "This week already has a draft. Restoring will replace it.";
}
