/**
 * T-2006/T-2030 — the sole authority for whether a model-authored sentence
 * may reach a client. Pure: no database access, no network calls, no
 * environment reads, no wall-clock reads. Everything this module decides
 * is a function of its arguments;
 * called twice per constrained-boundary run (once for `explanationText`,
 * once for `clarificationText`) from `constrained-boundary.ts`, which owns
 * the separate structural retention rule (R10) that this module does not
 * implement — see that file's comment.
 *
 * Rule order and codes are frozen in T-2006's `## Spec`. All nine rules run
 * on every call; every triggered reason code is collected, never just the
 * first (`accepted: false` never carries the rejected text — enforced in
 * the type, not by convention).
 *
 * Implementation note on R1 vs NFKC: the frozen rule text describes a
 * single normalization pipeline (NFKC, then quote mapping, then whitespace
 * collapse) and says "all matching is on N". Taken literally that would let
 * NFKC canonicalize an adversarial fullwidth-digit or other
 * compatibility-equivalent codepoint into a plain ASCII character *before*
 * the charset gate ever saw it — which would launder exactly the class of
 * input R1 exists to reject (see the fixture's fullwidth-digit case). This
 * implementation therefore runs the charset gate (R1) against the
 * pre-NFKC, post-quote-mapping string, and only applies NFKC afterward to
 * produce `N` for the remaining rules. For any input that is already plain
 * ASCII (every real case), NFKC is a no-op and the two orderings agree; the
 * reordering only changes behavior for the adversarial inputs R1 is meant
 * to catch. Flagged for the reviewer rather than silently resolved.
 */

export const PROSE_CONTRACT_VERSION = "t2006-prose-v1";

export type ProseNumericField = {
  id: string;
  value: number;
  unit: "KCAL_PER_DAY" | "GRAMS_PER_DAY";
  displayLabel: string;
  displayValue: string;
};

export type ProseDisplayName = {
  optionId: string;
  name: string;
};

export type ProseInputs = {
  outcome: "APPROVE_AUTOMATICALLY" | "HOLD" | "FOCUSED_CLARIFICATION" | "PAUSE_REFER";
  reasonCodes: string[];
  numericFields: ProseNumericField[];
  displayNames: ProseDisplayName[];
  catalogVocabulary: string[];
  maxCharacters: number;
  minCharacters: number;
  language: "en";
};

export type ProseRejectionCode =
  | "PROSE_EMPTY"
  | "PROSE_TOO_LONG"
  | "PROSE_TOO_SHORT"
  | "PROSE_CHARSET_REJECTED"
  | "PROSE_NUMBER_NOT_VALIDATED"
  | "PROSE_SPELLED_NUMERAL"
  | "PROSE_UNIT_NOT_SUPPLIED"
  | "PROSE_FOOD_OR_EXERCISE_NOT_IN_PLAN"
  | "PROSE_PROHIBITED_CLAIM"
  | "PROSE_OUTCOME_MISMATCH"
  | "PROSE_STRUCTURE_REJECTED";

export type ProseValidation =
  | { accepted: true; text: string; characters: number }
  | { accepted: false; reasonCodes: ProseRejectionCode[] };

export const SPELLED_NUMERALS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "hundreds",
  "thousand",
  "thousands",
  "million",
  "half",
  "quarter",
  "double",
  "triple",
  "dozen",
] as const;

export const PROHIBITED_CLAIM_TERMS = [
  "diagnose",
  "diagnoses",
  "diagnosis",
  "diagnosed",
  "diagnostic",
  "cure",
  "cures",
  "cured",
  "heal",
  "heals",
  "healing",
  "treat",
  "treats",
  "treated",
  "treatment",
  "therapy",
  "therapeutic",
  "medical",
  "medically",
  "medicine",
  "medication",
  "medications",
  "clinical",
  "clinically",
  "clinician",
  "doctor",
  "physician",
  "nurse",
  "dietitian",
  "nutritionist",
  "guarantee",
  "guarantees",
  "guaranteed",
  "risk-free",
  "risk free",
  "proven",
  "scientifically proven",
  "evidence-based",
  "backed by",
  "phd",
  "research shows",
  "studies show",
  "certified",
  "endorsed",
  "approved by",
  "nasm",
  "ace",
  "licensed",
  "supervised",
  "medically supervised",
  "monitor",
  "monitors",
  "monitored",
  "monitoring",
  "we noticed",
  "we've noticed",
  "we have noticed",
  "i noticed",
  "we see that",
  "we are watching",
  "we're watching",
  "we track",
  "we are tracking",
  "safe",
  "unsafe",
  "safely",
  "emergency",
  "urgent",
  "symptom",
  "symptoms",
  "disease",
  "disorder",
  "illness",
  "injury",
  "rehabilitation",
  "rehab",
  "pregnancy",
  "pregnant",
  "postpartum",
  "diabetes",
  "diabetic",
  "insulin",
  "blood sugar",
  "blood pressure",
  "heart rate",
  "cholesterol",
  "deficiency",
  "metabolism",
  "metabolic",
  "hormone",
  "hormones",
  "hormonal",
  "detox",
  "cleanse",
  "burn fat",
  "fat-burning",
  "torch",
  "shred",
  "fasting",
  "starve",
  "starvation",
  "boost",
  "optimal",
  "perfect",
  "best for you",
  "must",
  "need to",
  "have to",
  "always",
  "never",
] as const;

const UNIT_TERMS_BY_UNIT: Record<"KCAL_PER_DAY" | "GRAMS_PER_DAY", readonly string[]> = {
  KCAL_PER_DAY: ["kcal", "calories", "calorie", "per day", "a day", "daily"],
  GRAMS_PER_DAY: ["g", "gram", "grams", "per day", "a day", "daily"],
};

const PROHIBITED_UNIT_TERMS = [
  "kg",
  "kilogram",
  "kilograms",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "oz",
  "ounce",
  "ounces",
  "ml",
  "litre",
  "liter",
  "mg",
  "percent",
  "bpm",
  "mmhg",
  "mile",
  "miles",
  "km",
  "step",
  "steps",
  "minute",
  "minutes",
  "hour",
  "hours",
  "week",
  "weeks",
  "day",
] as const;

/**
 * The closed universe of unit words this module ever treats as
 * "unit-shaped" and potentially allowed. The per-call allow-list (R6) is a
 * derived subset of this, keyed by which units `inputs.numericFields`
 * actually carries — see `passesUnits`.
 */
export const ALLOWED_UNIT_TERMS: readonly string[] = Array.from(
  new Set([...UNIT_TERMS_BY_UNIT.KCAL_PER_DAY, ...UNIT_TERMS_BY_UNIT.GRAMS_PER_DAY])
);

export const PROSE_SYSTEM_RULES = [
  "explanationText and clarificationText are optional; omit (null) either one rather than guess.",
  "Every digit run you write in explanationText or clarificationText must be copied exactly, character-for-character, from a supplied numeric field's displayValue; never invent, round, convert, add a thousands separator to, or spell out a number.",
  "Only name a food or exercise that appears in the supplied display names; never mention any other food, exercise, brand or product name.",
  "Only use the supplied unit words for the numeric fields you were given; never state a different unit (weight in pounds/kilograms, percentages, time, distance, or a bare day count) even in passing.",
  "Never write a diagnosis, cure, guarantee, medical, clinical, credentialing, monitoring, or safety claim, and never describe yourself as watching, tracking or noticing the client.",
  "Never describe a plan, target, meal, workout or portion change unless the outcome is APPROVE_AUTOMATICALLY; if the outcome is not an approval, do not include any digit.",
  "Write at most three short, plain sentences with at most two parenthetical asides; keep punctuation simple and balanced.",
  "Only set clarificationText when concern.disposition is REQUEST_CLARIFICATION, and keep it a single focused question.",
] as const;

const ALLOWED_CHARSET_PATTERN = /^[A-Za-z0-9 .,;:'()-]*$/;
const DIGIT_RUN_PATTERN = /[0-9][0-9.,]*/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWordPattern(term: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "g");
}

/**
 * Curly quotes are mapped to straight ones and runs of literal ASCII spaces
 * are collapsed, matching the frozen normalization steps — but newlines,
 * tabs and other non-space whitespace are deliberately left untouched (not
 * collapsed away) so R1 below can see and reject them; `[A-Za-z0-9 .,;:'()-]`
 * has no newline/tab member.
 */
function normalizeQuotesAndSpaces(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ +/g, " ")
    .trim();
}

function passesStructure(N: string): boolean {
  if (N.includes("..")) return false;
  let openParens = 0;
  let pairs = 0;
  for (const char of N) {
    if (char === "(") openParens += 1;
    else if (char === ")") {
      openParens -= 1;
      if (openParens < 0) return false;
      pairs += 1;
    }
  }
  if (openParens !== 0) return false;
  if (pairs > 2) return false;
  const quoteCount = (N.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) return false;

  let sentences = 0;
  for (let index = 0; index < N.length; index += 1) {
    const char = N[index];
    if (char === ";") {
      sentences += 1;
      continue;
    }
    if (char === ".") {
      const prev = N[index - 1];
      const next = N[index + 1];
      const isDecimalPoint =
        prev !== undefined && next !== undefined && /[0-9]/.test(prev) && /[0-9]/.test(next);
      if (!isDecimalPoint) sentences += 1;
    }
  }
  if (sentences > 3) return false;

  const first = N[0];
  if (first !== undefined && !/[A-Za-z0-9]/.test(first)) return false;
  const last = N[N.length - 1];
  if (last !== undefined && last !== "." && !/[A-Za-z0-9]/.test(last)) return false;

  return true;
}

function buildAllowedNumericTokens(fields: readonly ProseNumericField[]): Set<string> {
  const tokens = new Set<string>();
  for (const field of fields) {
    tokens.add(field.displayValue);
    if (field.displayValue.endsWith(".0")) tokens.add(field.displayValue.slice(0, -2));
  }
  return tokens;
}

function passesDigits(N: string, fields: readonly ProseNumericField[]): boolean {
  const allowed = buildAllowedNumericTokens(fields);
  const runs = N.match(DIGIT_RUN_PATTERN) ?? [];
  for (const run of runs) {
    const token = /[.,]$/.test(run) ? run.slice(0, -1) : run;
    if (token.includes(",")) return false;
    if (!allowed.has(token)) return false;
  }
  return true;
}

function containsSpelledNumeral(L: string): boolean {
  return SPELLED_NUMERALS.some((word) => wholeWordPattern(word).test(L));
}

function passesUnits(L: string, fields: readonly ProseNumericField[]): boolean {
  const derivedAllowed = new Set<string>();
  for (const field of fields) {
    for (const term of UNIT_TERMS_BY_UNIT[field.unit]) derivedAllowed.add(term);
  }
  let masked = L;
  for (const phrase of derivedAllowed) {
    if (!phrase.includes(" ")) continue;
    masked = masked.replace(wholeWordPattern(phrase), (match) => " ".repeat(match.length));
  }
  for (const term of PROHIBITED_UNIT_TERMS) {
    if (derivedAllowed.has(term)) continue;
    if (wholeWordPattern(term).test(masked)) return false;
  }
  return true;
}

function passesCatalogVocabulary(
  L: string,
  displayNames: readonly ProseDisplayName[],
  catalogVocabulary: readonly string[]
): boolean {
  const supplied = new Set(displayNames.map((entry) => entry.name.toLowerCase()));
  for (const name of catalogVocabulary) {
    const lowered = name.toLowerCase();
    if (supplied.has(lowered)) continue;
    if (wholeWordPattern(lowered).test(L)) return false;
  }
  return true;
}

function lettersOnly(value: string): string {
  return value.replace(/[^a-z]/g, "");
}

function containsProhibitedClaim(L: string): boolean {
  for (const term of PROHIBITED_CLAIM_TERMS) {
    if (wholeWordPattern(term).test(L)) return true;
  }
  const letters = lettersOnly(L);
  for (const term of PROHIBITED_CLAIM_TERMS) {
    const termLetters = lettersOnly(term);
    if (termLetters.length >= 8 && letters.includes(termLetters)) return true;
  }
  return false;
}

const CHANGE_VERBS = [
  "increase",
  "increased",
  "increasing",
  "decrease",
  "decreased",
  "decreasing",
  "raise",
  "raised",
  "lower",
  "lowered",
  "adjust",
  "adjusted",
  "adjusting",
  "change",
  "changed",
  "changing",
  "update",
  "updated",
  "new target",
  "moved",
] as const;

const PAUSE_REFER_TERMS = [
  "plan",
  "program",
  "meal",
  "meals",
  "workout",
  "workouts",
  "session",
  "sessions",
  "target",
  "targets",
  "portion",
  "portions",
] as const;

function violatesOutcomeConsistency(L: string, outcome: ProseInputs["outcome"]): boolean {
  if (outcome !== "APPROVE_AUTOMATICALLY" && CHANGE_VERBS.some((term) => wholeWordPattern(term).test(L))) {
    return true;
  }
  if (outcome === "PAUSE_REFER" && PAUSE_REFER_TERMS.some((term) => wholeWordPattern(term).test(L))) {
    return true;
  }
  if (outcome === "HOLD" && /[0-9]/.test(L)) return true;
  return false;
}

/** Pure, deterministic, order-stable reason codes. The only prose authority. */
export function validateExplanationProse(
  inputs: ProseInputs,
  raw: string | null | undefined
): ProseValidation {
  const codes: ProseRejectionCode[] = [];
  const preNormalized = normalizeQuotesAndSpaces(raw ?? "");
  const N = preNormalized.normalize("NFKC");
  const L = N.toLowerCase();

  if (!ALLOWED_CHARSET_PATTERN.test(preNormalized)) {
    codes.push("PROSE_CHARSET_REJECTED");
  }

  if (preNormalized.length === 0) {
    codes.push("PROSE_EMPTY");
  } else {
    if (N.length > inputs.maxCharacters) codes.push("PROSE_TOO_LONG");
    if (N.length < inputs.minCharacters) codes.push("PROSE_TOO_SHORT");
    if (!passesStructure(N)) codes.push("PROSE_STRUCTURE_REJECTED");
  }

  if (!passesDigits(N, inputs.numericFields)) codes.push("PROSE_NUMBER_NOT_VALIDATED");
  if (containsSpelledNumeral(L)) codes.push("PROSE_SPELLED_NUMERAL");
  if (!passesUnits(L, inputs.numericFields)) codes.push("PROSE_UNIT_NOT_SUPPLIED");
  if (!passesCatalogVocabulary(L, inputs.displayNames, inputs.catalogVocabulary)) {
    codes.push("PROSE_FOOD_OR_EXERCISE_NOT_IN_PLAN");
  }
  if (containsProhibitedClaim(L)) codes.push("PROSE_PROHIBITED_CLAIM");
  if (violatesOutcomeConsistency(L, inputs.outcome)) codes.push("PROSE_OUTCOME_MISMATCH");

  if (codes.length === 0) {
    return { accepted: true, text: N, characters: N.length };
  }
  return { accepted: false, reasonCodes: codes };
}
