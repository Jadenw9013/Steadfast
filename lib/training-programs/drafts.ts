import { z } from "zod";
import { db } from "@/lib/db";
import type { BlockType, TrainingProgramStatus } from "@/app/generated/prisma/client";

/**
 * Single source of truth for training-program DRAFT content across both
 * transports: the web Server Action (`app/actions/training-programs.ts` —
 * `saveTrainingProgram`) and the iOS-facing REST route
 * (`app/api/coach/clients/[clientId]/training/route.ts` — POST/PUT). Both are
 * auth + zod + call + shape-response wrappers with no business logic. This
 * module exists because the two surfaces held two hand-maintained copies of the
 * block schema that had already drifted badly (T-622).
 *
 * It is NOT the only writer of `TrainingDay`/`TrainingProgramBlock` rows. Two
 * other paths create them directly and are deliberately untouched by T-622:
 * `app/api/workout-import/import/route.ts` (the OCR/LLM importer, validated by
 * `lib/validations/workout-import.ts`, which has no length or count caps) and
 * `app/api/coach/templates/[id]/apply/route.ts` (template → program draft, which
 * copies the template's `sortOrder` verbatim). Change those two as well whenever
 * the block contract changes here; follow-ups are filed to route them through
 * this module.
 *
 * The drift that made this module necessary:
 *
 *   - the route validated `type` against `["TEXT", "EXERCISE"]`. `"TEXT"` is not
 *     a member of `enum BlockType` at all, so it could only ever reach Prisma
 *     and 500; the four legitimate non-exercise types were rejected with 422
 *     while the Server Action accepted all six. The iOS coach editor therefore
 *     could not save an activation/cardio/superset/instruction/optional block
 *     at all.
 *   - `content` was capped at 2000 on the route and 5000 in the action, blocks
 *     at 30/day vs 50/day, `clientNotes` at 2000 vs 1000. The union below takes
 *     the LOOSER value of each pair on purpose, so nothing that is accepted
 *     today starts failing.
 *
 * Three normalization rules live here because they are the difference between a
 * saved program and a 500:
 *
 * 1. **`dayName` is `""`, never `null`/`undefined`.** `TrainingDay.dayName` is a
 *    required column with no default (`prisma/schema.prisma`), and both routes
 *    used to write `day.dayName || undefined`, which reaches Prisma as "field
 *    absent" on a required field → `PrismaClientValidationError` → 500. Empty
 *    day names are reachable in production: `lib/validations/workout-import.ts`
 *    defaults `dayName` to `""`, and iOS sends `null` for an untitled day.
 *
 * 2. **`title`/`content` are `""`, never `null`.** Both columns are
 *    `String @default("")` and the generated create input is `title?: string`,
 *    so `null` is not a legal value. Prisma's `Subset<T, U>` only checks key
 *    presence, not value types, so `tsc` never caught the old `?? null` —
 *    do not rely on the type-checker here, normalize at the parse boundary.
 *
 * 3. **`sortOrder` is dense and derived.** Days and blocks are stable-sorted by
 *    `(sortOrder ?? array index)` and then renumbered `0..n-1` by position, so a
 *    client that sends gapped, duplicated or absent sortOrder values still gets
 *    a well-ordered program. `TrainingProgramBlock.sortOrder` and
 *    `TrainingDay.sortOrder` are ORDERING values only and must never be used as
 *    a join key or a stable identifier: this module rewrites them on every save.
 *    The ordering readers are fine (e.g. `route.ts` GET,
 *    `lib/queries/training-programs.ts`,
 *    `lib/queries/current-client-plan.ts`,
 *    `app/api/training-programs/[programId]/export/route.ts` — all
 *    `orderBy: { sortOrder: "asc" }`). One reader does use it as a join key —
 *    `app/api/client/training/current/route.ts` joins `block.sortOrder` to
 *    `TrainingExercise.sortOrder` — which is inert today only because
 *    `TrainingExercise` has no writer anywhere in the repo (that dead join is a
 *    filed follow-up, T-622 review). Anyone who starts writing `TrainingExercise`
 *    must not resurrect that join.
 *
 * `__CARDIO__` (the web editor's convention for storing the cardio prescription
 * as a day holding one `CARDIO` block, `components/coach/training/training-program-editor.tsx`)
 * is deliberately NOT special-cased here. It is a day like any other; treating
 * it as data is exactly what lets it survive a round trip through iOS.
 *
 * Sibling module: `lib/training-programs/publish.ts` owns the DRAFT → PUBLISHED
 * transition (CB05 supersede). There is deliberately no import between the two
 * — this module never writes `TrainingProgram.status` to anything but
 * `"DRAFT"`, never sets `publishedAt`, and `publish.ts` never touches program
 * content. This module must not import `next/cache` or `lib/notifications`
 * either; `revalidatePath` stays in the Server Action. No network I/O inside
 * any transaction.
 */

/** `satisfies` pins the first direction: every literal here is a real member of
 *  `enum BlockType` (`prisma/schema.prisma`), so a typo or a removed value fails
 *  `tsc`. The exhaustiveness guard on `TRAINING_BLOCK_TYPES` below pins the
 *  other direction. `"TEXT"` is not and never was a member. */
const BLOCK_TYPE_LIST = [
  "EXERCISE",
  "ACTIVATION",
  "INSTRUCTION",
  "SUPERSET",
  "CARDIO",
  "OPTIONAL",
] as const satisfies readonly BlockType[];

/**
 * The only accepted block types, on both surfaces.
 *
 * The annotation is a compile-time exhaustiveness guard: if `enum BlockType`
 * ever gains a seventh value, `Exclude<...>` stops being `never`, the declared
 * type collapses to `never`, and this assignment fails `tsc` — in the one file
 * that has to know. Without it the new value would simply be 422'd on both
 * surfaces with no type error and no failing test (a unit test that lists the
 * same six literals can only agree with itself). Adding a value is a contract
 * change: it must land here, in the iOS block badge, and in the docs together.
 */
export const TRAINING_BLOCK_TYPES: [
  Exclude<BlockType, (typeof BLOCK_TYPE_LIST)[number]>,
] extends [never]
  ? typeof BLOCK_TYPE_LIST
  : never = BLOCK_TYPE_LIST;

/** Accepts absent / `null` / a string, always yields a string. See rules 1 and
 *  2 in the file header: `null` must never reach Prisma for any of these three
 *  columns. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v ?? "");

export const trainingBlockSchema = z.object({
  type: z.enum(TRAINING_BLOCK_TYPES).default("EXERCISE"),
  title: text(200),
  content: text(5000),
  /** Ordering hint only — never stored verbatim, see `normalizeTrainingDays`. */
  sortOrder: z.number().int().min(0).optional(),
});

export const trainingDaySchema = z.object({
  dayName: text(100),
  /** Ordering hint only — never stored verbatim. */
  sortOrder: z.number().int().min(0).optional(),
  blocks: z.array(trainingBlockSchema).max(50).default([]),
});

export const trainingDaysSchema = z.array(trainingDaySchema).max(14);

/** `z.coerce` because the Server Action's schema always coerced (the web editor
 *  sends a string from a `<select>`); keeping the looser of the two. */
export const weeklyFrequencySchema = z.coerce.number().int().min(1).max(7);

/** 2000 = the looser of the action's old 1000 and the route's 2000. */
export const clientNotesSchema = z.string().max(2000);

export type TrainingBlockInput = z.output<typeof trainingBlockSchema>;
export type TrainingDayInput = z.output<typeof trainingDaySchema>;

export type NormalizedTrainingBlock = {
  type: BlockType;
  title: string;
  content: string;
  sortOrder: number;
};

export type NormalizedTrainingDay = {
  dayName: string;
  sortOrder: number;
  blocks: NormalizedTrainingBlock[];
};

/** Stable sort by `(sortOrder ?? array index)`, ties broken by array index.
 *  `Array.prototype.sort` is already stable, but the explicit tiebreak makes
 *  the guarantee readable and survives a future comparator edit. */
function stableBySortOrder<T extends { sortOrder?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ao = a.item.sortOrder ?? a.index;
      const bo = b.item.sortOrder ?? b.index;
      return ao === bo ? a.index - b.index : ao - bo;
    })
    .map((entry) => entry.item);
}

/**
 * Orders days and blocks by `(sortOrder ?? index)` and rewrites `sortOrder` to a
 * dense `0..n-1` by position. Block ordering is normalized independently per
 * day. Pure — exported for the unit test.
 */
export function normalizeTrainingDays(days: TrainingDayInput[]): NormalizedTrainingDay[] {
  return stableBySortOrder(days).map((day, dayIndex) => ({
    dayName: day.dayName,
    sortOrder: dayIndex,
    blocks: stableBySortOrder(day.blocks).map((block, blockIndex) => ({
      type: block.type,
      title: block.title,
      content: block.content,
      sortOrder: blockIndex,
    })),
  }));
}

/** Nested-create payload for one day. Never emits `null`/`undefined` for
 *  `dayName`, `title` or `content` — see rules 1 and 2 in the file header. */
function dayCreateData(day: NormalizedTrainingDay) {
  return {
    dayName: day.dayName,
    sortOrder: day.sortOrder,
    blocks: {
      create: day.blocks.map((block) => ({
        type: block.type,
        title: block.title,
        content: block.content,
        sortOrder: block.sortOrder,
      })),
    },
  };
}

// ── Metadata ─────────────────────────────────────────────────────────────────

/**
 * Metadata write semantics, frozen and identical on both surfaces:
 *
 *   `weeklyFrequency` / `clientNotes` — REQUIRED. A number/string sets, `null`
 *     clears. Absent-means-clear is today's behavior on BOTH surfaces (the
 *     action passes `?? null`, the route's update writes `?? null`), and iOS
 *     sends an explicit `null` for "the coach emptied the field", so these must
 *     not quietly become patch semantics.
 *
 *   `injuries` / `equipment` / `templateSourceId` — `undefined` leaves the
 *     column unchanged (and inherits from the fork source on the fork path),
 *     `null` clears, a string sets. The Server Action passes all three
 *     (`?? null`); the REST route passes none, which is why it must be able to
 *     leave them alone.
 */
export type TrainingMetadataInput = {
  weeklyFrequency: number | null;
  clientNotes: string | null;
  injuries?: string | null;
  equipment?: string | null;
  templateSourceId?: string | null;
};

/** `undefined` keys are omitted entirely so Prisma leaves the column alone. */
function optionalMetadata(metadata: TrainingMetadataInput) {
  return {
    ...(metadata.injuries !== undefined && { injuries: metadata.injuries }),
    ...(metadata.equipment !== undefined && { equipment: metadata.equipment }),
    ...(metadata.templateSourceId !== undefined && {
      templateSourceId: metadata.templateSourceId,
    }),
  };
}

// ── Target lookup ────────────────────────────────────────────────────────────

/** Mirrors `lib/meal-plans/drafts.ts`'s two-function split for the same reason:
 *  the action calls `verifyCoachAccessToClient(target.clientId)` and throws, the
 *  route compares `target.clientId` against the URL segment and returns 403
 *  JSON. Both must authorize BETWEEN reading the row and writing it. */
export type TrainingSaveTarget = {
  id: string;
  clientId: string;
  weekOf: Date;
  status: TrainingProgramStatus;
  weeklyFrequency: number | null;
  clientNotes: string | null;
  injuries: string | null;
  equipment: string | null;
  templateSourceId: string | null;
};

const saveTargetSelect = {
  id: true,
  clientId: true,
  weekOf: true,
  status: true,
  weeklyFrequency: true,
  clientNotes: true,
  injuries: true,
  equipment: true,
  templateSourceId: true,
} as const;

/**
 * Reads the row both surfaces need before their own authorization check.
 * Returns null when the program does not exist. Performs no authorization.
 */
export async function getTrainingSaveTarget(
  programId: string
): Promise<TrainingSaveTarget | null> {
  return db.trainingProgram.findUnique({
    where: { id: programId },
    select: saveTargetSelect,
  });
}

/**
 * The Server Action's week-scoped target: the client's existing DRAFT for that
 * week, or null. CB05 — a PUBLISHED or SUPERSEDED program for the same
 * client/week is deliberately NOT a save target; saving over one used to demote
 * a client's live program back to DRAFT mid-edit. Performs no authorization.
 */
export async function findTrainingDraftForWeek(
  clientId: string,
  weekOf: Date
): Promise<TrainingSaveTarget | null> {
  return db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    select: saveTargetSelect,
  });
}

// ── Create ───────────────────────────────────────────────────────────────────

export type CreateTrainingProgramDraftInput = {
  clientId: string;
  /** Already parsed by `parseWeekStartDate` at the entry point. */
  weekOf: Date;
  days: TrainingDayInput[];
  metadata: TrainingMetadataInput;
};

/**
 * Creates a new DRAFT program with all of its days and blocks in ONE
 * transaction (the nested write is atomic). The Server Action used to create
 * the program row and then create the days in a separate transaction, which
 * left an orphaned empty program behind whenever day creation failed.
 * Callers MUST have authorized coach access to `input.clientId` first.
 */
export async function createTrainingProgramDraft(
  input: CreateTrainingProgramDraftInput
): Promise<{ programId: string }> {
  const days = normalizeTrainingDays(input.days);
  const program = await db.trainingProgram.create({
    data: {
      clientId: input.clientId,
      weekOf: input.weekOf,
      status: "DRAFT",
      weeklyFrequency: input.metadata.weeklyFrequency,
      clientNotes: input.metadata.clientNotes,
      ...optionalMetadata(input.metadata),
      days: { create: days.map(dayCreateData) },
    },
    select: { id: true },
  });
  return { programId: program.id };
}

// ── Save / fork ──────────────────────────────────────────────────────────────

export type SaveTrainingProgramContentInput = {
  days: TrainingDayInput[];
  metadata: TrainingMetadataInput;
};

export type SaveTrainingProgramContentResult = {
  /** Always the id that was submitted, forked or not. */
  programId: string;
  /** non-null ⇒ the target was not a DRAFT and CB05 forked a new one. */
  forkedNewProgramId: string | null;
};

/**
 * CB05. Callers MUST have authorized coach access to `target.clientId` first.
 *
 *   DRAFT       → replace every day/block and apply metadata, one transaction.
 *   anything else → fork a brand-new DRAFT carrying the submitted content and
 *                   inheriting the target's injuries/equipment/templateSourceId;
 *                   the target row is never touched.
 *
 * A PUBLISHED (or SUPERSEDED) `target` is never mutated in place — the client may
 * be reading its exact current content, so a stale editor (a second tab, or an
 * iOS coach who had the draft open while someone published on web) forks instead
 * of silently rewriting live content.
 *
 * That is a property of the branch, not of the whole operation: `target.status`
 * is read by the caller (`getTrainingSaveTarget` / `findTrainingDraftForWeek`)
 * before this function writes, so a publish that lands in between still lets the
 * DRAFT branch replace the days/blocks of a now-PUBLISHED program. Pre-existing,
 * unchanged by T-622, same class as the meal-plan race in T-745, and filed as
 * its own follow-up. Do not read this comment as a claim that the read-then-write
 * is atomic.
 */
export async function saveTrainingProgramContent(
  target: TrainingSaveTarget,
  input: SaveTrainingProgramContentInput
): Promise<SaveTrainingProgramContentResult> {
  const days = normalizeTrainingDays(input.days);
  const { metadata } = input;

  if (target.status !== "DRAFT") {
    const forked = await db.trainingProgram.create({
      data: {
        clientId: target.clientId,
        weekOf: target.weekOf,
        status: "DRAFT",
        weeklyFrequency: metadata.weeklyFrequency,
        clientNotes: metadata.clientNotes,
        // `undefined` means "leave unchanged", which on a fork means "inherit
        // from the program being forked".
        injuries: metadata.injuries !== undefined ? metadata.injuries : target.injuries,
        equipment: metadata.equipment !== undefined ? metadata.equipment : target.equipment,
        templateSourceId:
          metadata.templateSourceId !== undefined
            ? metadata.templateSourceId
            : target.templateSourceId,
        days: { create: days.map(dayCreateData) },
      },
      select: { id: true },
    });
    return { programId: target.id, forkedNewProgramId: forked.id };
  }

  const programId = target.id;

  // Metadata and children commit together: they used to be two separate
  // non-atomic operations, so a failed day write left the new weeklyFrequency
  // on the old days.
  await db.$transaction([
    db.trainingProgram.update({
      where: { id: programId },
      data: {
        weeklyFrequency: metadata.weeklyFrequency,
        clientNotes: metadata.clientNotes,
        ...optionalMetadata(metadata),
      },
    }),
    // Deleting the days cascades to their blocks.
    db.trainingDay.deleteMany({ where: { programId } }),
    ...days.map((day) => db.trainingDay.create({ data: { programId, ...dayCreateData(day) } })),
  ]);

  return { programId, forkedNewProgramId: null };
}
