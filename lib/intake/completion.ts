/**
 * Single source of truth for intake answer normalisation, merging and
 * completeness (T-624).
 *
 * Both transports of the client intake — the iOS-facing REST routes under
 * `app/api/intake/**` and the web Server Action `app/actions/client-intake.ts`
 * — define "this intake is complete" here and nowhere else. Before T-624 the
 * web action validated the whole answer set with zod before writing
 * `COMPLETED` while the REST route accepted any state, which let an iOS client
 * whose section saves silently failed end up `COMPLETED` with no answers.
 *
 * Everything in this file is pure: no db, no network, no `next/*` imports, so
 * it is unit-testable and safe to import from a route, an action or a test.
 */

export type IntakeAnswerItem = { questionId: string; answer: string };

/**
 * What `planClientIntakeUpdate` will actually persist (`data`) and the ids it
 * could not convert (`refusedQuestionIds`). Completeness must be derived from
 * `data`, never from the raw strings — see `planClientIntakeUpdate`.
 */
export type ClientIntakeUpdatePlan = {
  data: Record<string, unknown>;
  refusedQuestionIds: string[];
};

export type IntakeQuestionDTO = {
  id: string;
  label: string;
  type: string;
  required: boolean | null;
  options: string[] | null;
  placeholder: string | null;
};
export type IntakeSectionDTO = { id: string; title: string; questions: IntakeQuestionDTO[] };
export type IntakeTemplateDTO = { id: string; name: string; sections: IntakeSectionDTO[] };

/** Shown verbatim to the client by iOS (`APIService.userFacingErrorMessage`). */
export const INTAKE_INCOMPLETE_MESSAGE =
  "Some required answers didn't save. Go back through the form and tap Continue on each section.";

/**
 * Shown when a packet still has an unsigned document attached, on the web token
 * form (`app/actions/intake.ts` `submitIntakePacket`). Wording unchanged: the
 * client is already on the one surface that collects signatures, so "sign them"
 * is an instruction they can act on where they are standing.
 */
export const DOCUMENTS_UNSIGNED_MESSAGE = "Please sign all documents before submitting.";

/**
 * The same refusal on the iOS-facing REST submit, where the sentence above
 * would be a dead end: there is no signing UI in the app at all, so naming the
 * task without naming the place leaves the client tapping Retry forever
 * (T-624 review r3 finding 1). This names the escape hatch that already exists
 * — the intake link the coach's packet email contains — and says "finish"
 * rather than "sign" on purpose: signatures are only written when that form is
 * submitted, so signing there without submitting would not lift this refusal.
 * Shown verbatim by iOS (`APIService.userFacingErrorMessage`); keep it one
 * plain sentence under 300 characters.
 */
/**
 * Shown when a section save carries a value its column cannot hold (T-624
 * review r3, folded T-788). The save route used to drop such a value and answer
 * 200, which iOS reads as "saved" whenever the column already held an old value
 * to echo back — a failed save that neither blocks nor errors, i.e. this
 * ticket's own AC1. Refusing names the problem instead.
 */
export const ANSWER_UNSTORABLE_MESSAGE =
  "Some answers couldn't be saved, because a number field needs a plain number.";

export const DOCUMENTS_UNSIGNED_APP_MESSAGE =
  "Your coach attached documents to sign, so please finish this form using the intake link they emailed you.";

/**
 * The built-in template used for `ClientIntake` (the simple intake stepper) and
 * as the fallback when a coach has not customised their own intake form.
 * Moved verbatim from `app/api/intake/current/route.ts`.
 */
export const CLIENT_INTAKE_TEMPLATE: IntakeTemplateDTO = {
  id: "ci_default_template",
  name: "Intake Questionnaire",
  sections: [
    {
      id: "ci_sec_body",
      title: "Body Measurements",
      questions: [
        { id: "bodyweightLbs", label: "What is your current bodyweight?", type: "number", required: true, options: null, placeholder: "e.g. 175" },
        { id: "heightInches", label: "How tall are you? (inches)", type: "number", required: true, options: null, placeholder: "e.g. 70 (5′10″ = 70)" },
        { id: "ageYears", label: "How old are you?", type: "number", required: true, options: null, placeholder: "e.g. 28" },
        { id: "gender", label: "What is your gender?", type: "select", required: true, options: ["Male", "Female", "Prefer not to say"], placeholder: null },
      ],
    },
    {
      id: "ci_sec_goals",
      title: "Goals & Training",
      questions: [
        { id: "primaryGoal", label: "What is your primary goal?", type: "select", required: true, options: ["Lose body fat", "Build muscle", "Improve athletic performance", "Maintain weight", "General health"], placeholder: null },
        { id: "trainingExperience", label: "How would you describe your training experience?", type: "select", required: true, options: ["Beginner (0–1 year)", "Some experience (1–2 years)", "Intermediate (2–5 years)", "Advanced (5+ years)"], placeholder: null },
        { id: "trainingDaysPerWeek", label: "How many days per week can you train?", type: "number", required: true, options: null, placeholder: "e.g. 4" },
        { id: "gymAccess", label: "What equipment do you have access to?", type: "select", required: true, options: ["Full gym membership", "Home gym with equipment", "Minimal equipment (dumbbells / bands)", "No equipment (bodyweight only)"], placeholder: null },
      ],
    },
    {
      id: "ci_sec_diet",
      title: "Diet & Restrictions",
      questions: [
        { id: "dietaryRestrictions", label: "Do you have any dietary restrictions?", type: "textarea", required: false, options: null, placeholder: "e.g. Vegetarian, gluten-free, no dairy… (or type \"None\")" },
        { id: "dietaryPreferences", label: "Any other food preferences or dislikes?", type: "textarea", required: false, options: null, placeholder: "e.g. I don't like fish, I prefer Mediterranean foods…" },
        { id: "currentDiet", label: "Describe what you typically eat in a day", type: "textarea", required: false, options: null, placeholder: "Walk me through a typical day of eating—meals, snacks, rough portions…" },
      ],
    },
    {
      id: "ci_sec_health",
      title: "Health & Injuries",
      questions: [
        { id: "injuries", label: "Do you have any injuries or physical limitations?", type: "textarea", required: false, options: null, placeholder: "Describe any injuries, pain, or movement restrictions… (or type \"None\")" },
      ],
    },
  ],
};

// ── ClientIntake column whitelist ────────────────────────────────────────────
// A questionId maps directly to a ClientIntake column. Only these are allowed.
export const CI_NUMBER_FIELDS: ReadonlySet<string> = new Set(["bodyweightLbs", "heightInches"]);
export const CI_INT_FIELDS: ReadonlySet<string> = new Set(["ageYears", "trainingDaysPerWeek"]);
export const CI_STRING_FIELDS: ReadonlySet<string> = new Set([
  "gender", "primaryGoal", "trainingExperience", "gymAccess",
  "injuries", "dietaryRestrictions", "dietaryPreferences", "currentDiet",
]);
export const CI_ALL_FIELDS: ReadonlySet<string> = new Set([
  ...CI_NUMBER_FIELDS, ...CI_INT_FIELDS, ...CI_STRING_FIELDS,
]);

/**
 * Bounds of a Postgres 4-byte `integer`, which is what every `CI_INT_FIELDS`
 * column is. A value outside them is not storable: `parseInt("99999999999")` is
 * a perfectly finite number that the query engine then rejects, turning a
 * submit the client has no other way to complete into a 500. Refusing it in
 * `planClientIntakeUpdate` makes it a 422 that names the field instead.
 *
 * This is a *storability* bound, not a plausibility range: the product ranges
 * (50-700 lbs, 24-108 in) live in `lib/validations/client-intake.ts` and are
 * deliberately not enforced on the REST path by T-624 — doing so needs a second
 * user-facing message and is outside this ticket's frozen contract.
 */
const PG_INT_MIN = -2147483648;
const PG_INT_MAX = 2147483647;

/**
 * Wire order of the ClientIntake answers array. Kept identical to the order the
 * three routes used before T-624 so the response body does not move.
 */
const CI_FIELD_ORDER: readonly string[] = [
  "bodyweightLbs", "heightInches", "ageYears", "gender", "primaryGoal",
  "trainingExperience", "trainingDaysPerWeek", "gymAccess",
  "injuries", "dietaryRestrictions", "dietaryPreferences", "currentDiet",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

/**
 * The single blank predicate for the whole intake pipeline (T-624 review
 * finding 4). Absent, empty and whitespace-only all mean "no answer", on the
 * read side as well as the write side: `missingRequiredAnswers` counts "   " as
 * missing, so if a read path let one through, a legacy row holding "   " would
 * be returned on the wire as a filled answer, keep iOS permanently dirty and
 * then 422 on a field that looks answered.
 */
export function isBlank(value: unknown): boolean {
  if (value == null) return true;
  return String(value).trim() === "";
}

/**
 * Top-level `formAnswers` keys that are structure, not answers: `sections` is
 * the nested `IntakeAnswersShape` the web token form writes, and `_`-prefixed
 * keys are web metadata (`_coachNotes`, `_savedAt`). They are never read as an
 * answer and — since T-624 — never writable by a client-supplied questionId.
 */
function isReservedPacketKey(key: string): boolean {
  return key === "sections" || key.startsWith("_");
}

/**
 * Parse the `answers` value of a request body.
 *
 * Accepts the array form iOS sends (`[{ questionId, answer }]`) and the legacy
 * object form (`{ questionId: value }`). Returns `null` when the value is not
 * one of those two shapes — callers turn that into a 400. An `answer` of `""`
 * survives: it is the explicit "clear this answer" instruction.
 */
export function normalizeAnswerInput(raw: unknown): IntakeAnswerItem[] | null {
  if (Array.isArray(raw)) {
    const items: IntakeAnswerItem[] = [];
    for (const entry of raw) {
      if (!isPlainObject(entry)) continue;
      const questionId = entry.questionId;
      if (typeof questionId !== "string" || questionId === "") continue;
      const answer = scalarToString(entry.answer);
      if (answer === null) continue;
      items.push({ questionId, answer });
    }
    return items;
  }
  if (isPlainObject(raw)) {
    const items: IntakeAnswerItem[] = [];
    for (const [questionId, value] of Object.entries(raw)) {
      const answer = scalarToString(value);
      if (answer === null) continue;
      items.push({ questionId, answer });
    }
    return items;
  }
  return null;
}

/**
 * Read `IntakePacket.formAnswers` in either storage shape:
 *   - the flat map the iOS REST route writes (`{ questionId: value }`)
 *   - the nested `IntakeAnswersShape` the web token form writes
 *     (`{ sections: [{ answers: [{ questionId, value }] }] }`)
 * Empty and non-scalar values are dropped. See T-762 for the shape mismatch
 * itself; reading both here means the completeness guard can never 422 a packet
 * that was filled in on the web.
 *
 * Precedence is flat-over-nested: only the flat keys are written by
 * `mergePacketAnswers`, so on a **stored** packet that holds both shapes (a
 * coach edited the review page before the client finished), the flat value is
 * the newer one. Reading it the other way round makes a just-saved answer
 * revert in the PUT echo — T-624 review r1 finding 2. This precedence is
 * specific to reading STORED data; `packetAnswerItems` below, which reads a
 * freshly SUBMITTED payload, needs the opposite rule and says why.
 */
export function flattenPacketAnswers(formAnswers: unknown): Record<string, string> {
  return collectPacketAnswers(formAnswers, false, "flat-wins");
}

/**
 * Every answer a packet payload carries, blanks INCLUDED, as merge items —
 * used by `mergePacketSubmission` to interpret a payload a form JUST
 * submitted, never a stored `formAnswers` value.
 *
 * `flattenPacketAnswers` answers "what does this packet say?" and therefore
 * drops blanks and uses flat-over-nested precedence, which is correct for
 * STORED data. This answers "what did this form submit?", where the nested
 * `sections` are what the form's controls actually edited and any flat keys
 * present are stale carry-over the caller spread in from the row it loaded —
 * `components/coach/intake/review-session.tsx` does exactly that: its
 * `answers` state starts from the whole stored `formAnswers` object (flat keys
 * included) and only `sections` is ever mutated by `commitAnswer`. So here the
 * precedence flips to **nested-over-flat**: the nested value the form just
 * edited wins over a same-request flat key (T-624 review r4 finding 1). A
 * blank is kept because the client/coach leaving a question empty is an
 * explicit clear that must survive, on either side of the precedence.
 *
 * Both directions read the same two storage shapes through
 * `collectPacketAnswers`, so there is one traversal of `formAnswers` in the
 * codebase, not two.
 */
export function packetAnswerItems(formAnswers: unknown): IntakeAnswerItem[] {
  return Object.entries(collectPacketAnswers(formAnswers, true, "nested-wins")).map(
    ([questionId, answer]) => ({ questionId, answer })
  );
}

function collectPacketAnswers(
  formAnswers: unknown,
  keepBlank: boolean,
  precedence: "flat-wins" | "nested-wins"
): Record<string, string> {
  if (!isPlainObject(formAnswers)) return {};

  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(formAnswers)) {
    if (isReservedPacketKey(key)) continue;
    const str = scalarToString(value);
    if (str === null || (!keepBlank && isBlank(str))) continue;
    flat[key] = str;
  }

  const nested: Record<string, string> = {};
  const sections = formAnswers.sections;
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (!isPlainObject(section)) continue;
      const answers = section.answers;
      if (!Array.isArray(answers)) continue;
      for (const answer of answers) {
        if (!isPlainObject(answer)) continue;
        const questionId = answer.questionId;
        if (typeof questionId !== "string" || isReservedPacketKey(questionId)) continue;
        const str = scalarToString(answer.value);
        if (str === null || (!keepBlank && isBlank(str))) continue;
        nested[questionId] = str;
      }
    }
  }

  // Whichever side "wins" is applied LAST, so it overwrites the other.
  return precedence === "nested-wins" ? { ...flat, ...nested } : { ...nested, ...flat };
}

/**
 * Merge incoming answers into an existing `formAnswers` object.
 * A blank answer deletes the key (that is the explicit clear) and, on a packet
 * that also holds the nested shape, blanks the matching nested entry so the
 * clear cannot be undone by a fallback read (see `blankNestedAnswers`).
 * Unknown top-level keys such as `_coachNotes` are preserved untouched, and so
 * is the `sections` array itself apart from the values of cleared answers.
 *
 * `questionId` comes straight from the client, so a reserved key is refused on
 * write (T-624 review finding 3): `PUT {"questionId":"sections"}` would
 * otherwise replace the nested answers the coach's review page reads with a
 * bare string, and `sections.map(...)` on `/coach/clients/[clientId]` would
 * throw. Refusing the write (rather than restricting the merge to the current
 * template's question ids) keeps a client's in-flight answer from being
 * silently dropped when a coach edits their template mid-intake, which is the
 * very harm this ticket exists to stop. The reserved keys are also unreadable
 * as answers (`flattenPacketAnswers`), so nothing is lost by refusing them.
 */
export function mergePacketAnswers(
  existing: unknown,
  incoming: IntakeAnswerItem[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  const cleared = new Set<string>();
  for (const item of incoming) {
    if (isReservedPacketKey(item.questionId)) continue;
    if (isBlank(item.answer)) {
      delete merged[item.questionId];
      cleared.add(item.questionId);
    } else {
      merged[item.questionId] = item.answer;
    }
  }
  // Only touch `sections` when it is really there: assigning unconditionally
  // would add a `sections: undefined` key to a flat-only packet.
  if (cleared.size > 0 && Array.isArray(merged.sections)) {
    merged.sections = blankNestedAnswers(merged.sections, cleared);
  }
  return merged;
}

/**
 * The clear half of the two-shape problem (T-624 review finding 3, r2).
 * Deleting the flat key is not enough on a packet that also holds the nested
 * `IntakeAnswersShape` (a coach click-edited an un-submitted packet): with the
 * flat key gone, `flattenPacketAnswers` falls back to the coach's stale nested
 * value, so the echo, `GET /api/intake/current` and the submit guard all report
 * the answer as still present and the field repopulates on the client's screen
 * — the "clearing is persisted, not dropped" criterion, broken.
 *
 * So a clear blanks the matching nested entry too. The entry is KEPT with
 * `value: ""` rather than removed: `/coach/clients/[clientId]` and the review
 * page `.map()` over these arrays and read `label` (the `questionLabel` key in
 * `IntakeAnswersShape` describes `ClientFormSubmission.answers`, a different
 * table — no writer of `IntakePacket.formAnswers` uses it), so dropping the
 * entry would change what the coach sees structurally. Returns the input
 * untouched (same reference) when nothing matches, and never mutates it.
 */
function blankNestedAnswers(sections: unknown, cleared: ReadonlySet<string>): unknown {
  if (!Array.isArray(sections)) return sections;
  let changed = false;
  const next = sections.map((section) => {
    if (!isPlainObject(section) || !Array.isArray(section.answers)) return section;
    let sectionChanged = false;
    const answers = section.answers.map((answer) => {
      if (!isPlainObject(answer)) return answer;
      const questionId = answer.questionId;
      if (typeof questionId !== "string" || !cleared.has(questionId)) return answer;
      if (isBlank(answer.value)) return answer;
      sectionChanged = true;
      return { ...answer, value: "" };
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, answers };
  });
  return changed ? next : sections;
}

/**
 * Merge a whole submitted/edited `formAnswers` payload into what is already
 * stored, instead of replacing it (T-624 review r3 finding 1).
 *
 * The web token form and the coach's review page both used to write
 * `formAnswers: input.answers` wholesale. That is destructive now that a packet
 * can hold answers from two surfaces: a client who fills the intake in the iOS
 * app (flat keys) and is then refused at submit — for an unsigned document, the
 * only refusal the app cannot resolve itself — has to finish on the emailed
 * token link, and a wholesale write there erases every answer they already
 * saved. It is also the mirror image of the reserved-key attack T-624 closed:
 * one surface silently dropping another surface's data.
 *
 * Semantics: every answer the payload carries is merged through
 * `mergePacketAnswers`, so a value sets the flat key, a blank clears it, and a
 * questionId the payload does not mention keeps whatever is stored. The
 * payload's own structural keys (`sections`, `_`-prefixed metadata) then
 * replace the stored ones, because the submitting form owns the structure it
 * rendered — and structural keys are never client-supplied questionIds here,
 * unlike in `mergePacketAnswers`.
 */
export function mergePacketSubmission(
  existing: unknown,
  submitted: unknown
): Record<string, unknown> {
  const merged = mergePacketAnswers(existing, packetAnswerItems(submitted));
  if (isPlainObject(submitted)) {
    for (const [key, value] of Object.entries(submitted)) {
      if (isReservedPacketKey(key)) merged[key] = value;
    }
  }
  return merged;
}

/** ClientIntake row → `{ questionId: answer }`, empty columns omitted. */
export function clientIntakeToAnswerMap(ci: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CI_FIELD_ORDER) {
    const value = ci[field];
    if (isBlank(value)) continue;
    out[field] = String(value);
  }
  return out;
}

/**
 * Incoming answers → ClientIntake column updates, plus the ids the conversion
 * REFUSED.
 *
 * A blank answer clears the column to `null` — for numeric columns too, which
 * is what the pre-T-624 route could not do (it `parseFloat`'d and dropped NaN,
 * so a cleared number never reached the database). A non-blank value that does
 * not parse as a number (".", "5ft10", "175 lbs") cannot be stored in a numeric
 * column, so its id is reported in `refusedQuestionIds` instead of being
 * silently dropped: submit turns that into a 422 rather than writing COMPLETED
 * with the column still null (T-624 review finding 1). The same applies to a
 * value that parses but cannot be stored — `Infinity` ("1e999") or an integer
 * outside the Postgres `integer` range. Unknown questionIds are ignored
 * entirely.
 */
export function planClientIntakeUpdate(incoming: IntakeAnswerItem[]): ClientIntakeUpdatePlan {
  const data: Record<string, unknown> = {};
  const refusedQuestionIds: string[] = [];
  for (const item of incoming) {
    if (!CI_ALL_FIELDS.has(item.questionId)) continue;
    const value = item.answer;
    const empty = isBlank(value);
    if (CI_NUMBER_FIELDS.has(item.questionId)) {
      if (empty) { data[item.questionId] = null; continue; }
      const n = parseFloat(value);
      // `Number.isFinite`, not `!isNaN`: `parseFloat("1e999")` is Infinity, and
      // Infinity is not blank, so an isNaN-only check let the guard project
      // `String(Infinity)` as an answer and write COMPLETED with a column
      // Prisma would either reject (500) or coerce away (the r1 BLOCKER again).
      if (!Number.isFinite(n)) refusedQuestionIds.push(item.questionId);
      else data[item.questionId] = n;
    } else if (CI_INT_FIELDS.has(item.questionId)) {
      if (empty) { data[item.questionId] = null; continue; }
      const n = parseInt(value, 10);
      // Finite AND inside the Postgres integer range — see PG_INT_MIN/MAX.
      if (!Number.isFinite(n) || n < PG_INT_MIN || n > PG_INT_MAX) {
        refusedQuestionIds.push(item.questionId);
      } else data[item.questionId] = n;
    } else {
      data[item.questionId] = empty ? null : value;
    }
  }
  return { data, refusedQuestionIds };
}

/**
 * The column payload only. Convenience wrapper over `planClientIntakeUpdate`,
 * kept because it is on T-624's frozen export list — but no route calls it any
 * more: both the save and the submit path need `refusedQuestionIds`, and
 * discarding them is what let an unstorable value look saved.
 */
export function clientIntakeUpdateData(incoming: IntakeAnswerItem[]): Record<string, unknown> {
  return planClientIntakeUpdate(incoming).data;
}

/** `{ questionId: answer }` → the wire array. Empty answers never go on the wire. */
export function toAnswersArray(map: Record<string, string>): IntakeAnswerItem[] {
  return Object.entries(map)
    .filter(([, value]) => !isBlank(value))
    .map(([questionId, answer]) => ({ questionId, answer: String(answer) }));
}

/**
 * The attached documents a packet submit has no signature for.
 *
 * One predicate for both submit surfaces (standing rule 1): the web token form
 * passes the signatures it is creating in the same request, the iOS REST route
 * passes the ids of the `DocumentSignature` rows that already exist. A signed
 * FILE upload also produces a signature row (`FILE_UPLOADED:` value), so "has a
 * signature row" is the whole definition of signed on both paths.
 */
export function unsignedDocumentIds(
  documents: readonly { id: string }[],
  signedDocumentIds: Iterable<string>
): string[] {
  const signed = new Set(signedDocumentIds);
  return documents.filter((doc) => !signed.has(doc.id)).map((doc) => doc.id);
}

/**
 * Ids of the questions a template marks required.
 * Tolerant of coach-authored JSON: a non-array `sections`, a section with no
 * `questions`, a question with no `id`, and a `required` that is absent, null
 * or not a boolean all mean "not required" — never a throw.
 */
export function requiredQuestionIds(sections: unknown): string[] {
  if (!Array.isArray(sections)) return [];
  const ids: string[] = [];
  for (const section of sections) {
    if (!isPlainObject(section)) continue;
    const questions = section.questions;
    if (!Array.isArray(questions)) continue;
    for (const question of questions) {
      if (!isPlainObject(question)) continue;
      const id = question.id;
      if (typeof id !== "string" || isBlank(id)) continue;
      // A reserved id can never be stored or read back as an answer, so marking
      // it required would lock the client out of submitting forever.
      if (isReservedPacketKey(id)) continue;
      if (question.required !== true) continue;
      ids.push(id);
    }
  }
  return ids;
}

/**
 * The required questions that are still unanswered. Absent, empty and
 * whitespace-only answers all count as missing.
 */
export function missingRequiredAnswers(
  sections: unknown,
  answers: Record<string, string>
): string[] {
  return requiredQuestionIds(sections).filter((id) => isBlank(answers[id]));
}

/**
 * A coach's stored `IntakeFormTemplate` row → the wire template, falling back
 * to `CLIENT_INTAKE_TEMPLATE` when the coach has not customised their form.
 * `template` on the wire is never null.
 */
export function resolveIntakeTemplate(
  row: { id: string; sections: unknown } | null | undefined
): IntakeTemplateDTO {
  if (!row) return CLIENT_INTAKE_TEMPLATE;
  return {
    id: row.id,
    name: "Intake Questionnaire",
    sections: (Array.isArray(row.sections) ? row.sections : []) as IntakeSectionDTO[],
  };
}
