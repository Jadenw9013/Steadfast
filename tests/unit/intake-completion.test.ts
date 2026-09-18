import { describe, expect, it } from "vitest";
import {
  ANSWER_UNSTORABLE_MESSAGE,
  CLIENT_INTAKE_TEMPLATE,
  DOCUMENTS_UNSIGNED_APP_MESSAGE,
  DOCUMENTS_UNSIGNED_MESSAGE,
  INTAKE_INCOMPLETE_MESSAGE,
  clientIntakeToAnswerMap,
  clientIntakeUpdateData,
  flattenPacketAnswers,
  isBlank,
  mergePacketAnswers,
  mergePacketSubmission,
  missingRequiredAnswers,
  normalizeAnswerInput,
  packetAnswerItems,
  planClientIntakeUpdate,
  unsignedDocumentIds,
  requiredQuestionIds,
  resolveIntakeTemplate,
  toAnswersArray,
} from "@/lib/intake/completion";

/**
 * T-624 — the shared intake completion service is the single definition of
 * "this intake is complete" for the REST routes and the web Server Action.
 * These tests pin the tolerant-parsing rules, because the coach-authored
 * template JSON is untrusted input and a throw here would 500 a submit.
 */
describe("intake completion service", () => {
  describe("requiredQuestionIds", () => {
    it("returns exactly the 8 required ids of the built-in template", () => {
      expect(requiredQuestionIds(CLIENT_INTAKE_TEMPLATE.sections)).toEqual([
        "bodyweightLbs",
        "heightInches",
        "ageYears",
        "gender",
        "primaryGoal",
        "trainingExperience",
        "trainingDaysPerWeek",
        "gymAccess",
      ]);
    });

    it("only treats a literal boolean true as required", () => {
      const sections = [
        {
          id: "s1",
          title: "S1",
          questions: [
            { id: "yes", label: "", type: "short_text", required: true },
            { id: "no", label: "", type: "short_text", required: false },
            { id: "absent", label: "", type: "short_text" },
            { id: "null", label: "", type: "short_text", required: null },
            { id: "stringy", label: "", type: "short_text", required: "yes" },
          ],
        },
      ];
      expect(requiredQuestionIds(sections)).toEqual(["yes"]);
    });

    it("never throws on malformed coach-authored JSON", () => {
      expect(requiredQuestionIds(null)).toEqual([]);
      expect(requiredQuestionIds(undefined)).toEqual([]);
      expect(requiredQuestionIds({})).toEqual([]);
      expect(requiredQuestionIds("x")).toEqual([]);
      expect(requiredQuestionIds(({ sections: "x" } as unknown))).toEqual([]);
      expect(requiredQuestionIds([{ id: "s", title: "t" }])).toEqual([]);
      expect(requiredQuestionIds([{ questions: "nope" }])).toEqual([]);
      expect(requiredQuestionIds([{ questions: [null, 3, { required: true }] }])).toEqual([]);
    });

    it("never treats a reserved id as required (it could never be answered)", () => {
      const sections = [
        {
          questions: [
            { id: "sections", required: true },
            { id: "_coachNotes", required: true },
            { id: "   ", required: true },
            { id: "q_real", required: true },
          ],
        },
      ];
      expect(requiredQuestionIds(sections)).toEqual(["q_real"]);
    });
  });

  describe("missingRequiredAnswers", () => {
    it("counts absent, empty and whitespace-only answers as missing", () => {
      const answers = {
        bodyweightLbs: "175",
        heightInches: "",
        ageYears: "   ",
        gender: "Male",
        primaryGoal: "Build muscle",
        trainingExperience: "Beginner (0–1 year)",
        trainingDaysPerWeek: "4",
        gymAccess: "Full gym membership",
      };
      expect(missingRequiredAnswers(CLIENT_INTAKE_TEMPLATE.sections, answers)).toEqual([
        "heightInches",
        "ageYears",
      ]);
    });

    it("never reports a non-required question, answered or not", () => {
      const answered = Object.fromEntries(
        requiredQuestionIds(CLIENT_INTAKE_TEMPLATE.sections).map((id) => [id, "x"])
      );
      expect(missingRequiredAnswers(CLIENT_INTAKE_TEMPLATE.sections, answered)).toEqual([]);
      expect(
        missingRequiredAnswers(CLIENT_INTAKE_TEMPLATE.sections, { ...answered, injuries: "" })
      ).toEqual([]);
    });

    it("exposes a user-facing message for the 422", () => {
      expect(INTAKE_INCOMPLETE_MESSAGE).toContain("Continue");
    });

    it("gives the app's unsigned-document refusal a route out, unlike the web one", () => {
      // The app has no signing UI, so naming the task without naming the place
      // is a dead end (review r3 finding 1). iOS shows `error` verbatim only
      // while it is <= 300 characters (`APIService.userFacingErrorMessage`).
      expect(DOCUMENTS_UNSIGNED_APP_MESSAGE).toBe(
        "Your coach attached documents to sign, so please finish this form using the intake link they emailed you."
      );
      expect(DOCUMENTS_UNSIGNED_APP_MESSAGE.length).toBeLessThanOrEqual(300);
      expect(DOCUMENTS_UNSIGNED_APP_MESSAGE).not.toBe(DOCUMENTS_UNSIGNED_MESSAGE);
      // the web token form keeps the sentence that fits where it is shown
      expect(DOCUMENTS_UNSIGNED_MESSAGE).toBe("Please sign all documents before submitting.");
    });

    it("exposes a user-facing message for the save-route 422", () => {
      expect(ANSWER_UNSTORABLE_MESSAGE).toBe(
        "Some answers couldn't be saved, because a number field needs a plain number."
      );
      expect(ANSWER_UNSTORABLE_MESSAGE.length).toBeLessThanOrEqual(300);
    });
  });

  describe("flattenPacketAnswers", () => {
    it("returns a flat map unchanged", () => {
      expect(flattenPacketAnswers({ q_goal: "lose fat", q_days: "4" })).toEqual({
        q_goal: "lose fat",
        q_days: "4",
      });
    });

    it("reads the nested IntakeAnswersShape the web token form writes", () => {
      const nested = {
        sections: [
          {
            sectionId: "sec_goals",
            sectionTitle: "Goals",
            answers: [
              { questionId: "q_goal", label: "Goal", value: "lose fat" },
              { questionId: "q_empty", label: "Empty", value: "" },
            ],
          },
        ],
        _coachNotes: "note",
        _savedAt: 1,
      };
      expect(flattenPacketAnswers(nested)).toEqual({ q_goal: "lose fat" });
    });

    it("lets a newer flat key override a stale nested one (review finding 2)", () => {
      // A coach edited the review page on an un-submitted packet, writing the
      // nested shape; the client then saved on iOS, which writes flat keys.
      // The flat value is the newer one and must win, or the PUT echo reverts
      // the answer the client just typed.
      const mixed = {
        sections: [
          {
            sectionId: "sec_basics",
            answers: [
              { questionId: "q_goal", value: "old value" },
              { questionId: "q_days", value: "3" },
            ],
          },
        ],
        q_goal: "new value",
      };
      expect(flattenPacketAnswers(mixed)).toEqual({ q_goal: "new value", q_days: "3" });
    });

    it("treats whitespace-only values as blank in both shapes", () => {
      expect(flattenPacketAnswers({ q_goal: "   ", q_days: "4" })).toEqual({ q_days: "4" });
      expect(
        flattenPacketAnswers({
          sections: [{ answers: [{ questionId: "q_goal", value: "  \n " }] }],
        })
      ).toEqual({});
    });

    it("returns {} for null or garbage and drops non-scalar values", () => {
      expect(flattenPacketAnswers(null)).toEqual({});
      expect(flattenPacketAnswers("nope")).toEqual({});
      expect(flattenPacketAnswers(42)).toEqual({});
      expect(flattenPacketAnswers([])).toEqual({});
      expect(flattenPacketAnswers({ a: { nested: true }, b: "ok", c: "" })).toEqual({ b: "ok" });
    });
  });

  describe("mergePacketAnswers", () => {
    it("sets, overwrites, deletes on empty and preserves unknown keys", () => {
      const existing = { sections: [{ sectionId: "s" }], keep: "yes", old: "value", gone: "x" };
      const merged = mergePacketAnswers(existing, [
        { questionId: "old", answer: "new value" },
        { questionId: "fresh", answer: "added" },
        { questionId: "gone", answer: "" },
      ]);
      expect(merged).toEqual({
        sections: [{ sectionId: "s" }],
        keep: "yes",
        old: "new value",
        fresh: "added",
      });
      expect("gone" in merged).toBe(false);
      // input not mutated
      expect(existing.gone).toBe("x");
    });

    it("refuses a reserved questionId so a client cannot overwrite `sections` (review finding 3)", () => {
      const existing = {
        sections: [{ sectionId: "s", answers: [{ questionId: "q_goal", value: "Lose fat" }] }],
        _coachNotes: "note",
      };
      const merged = mergePacketAnswers(existing, [
        { questionId: "sections", answer: "x" },
        { questionId: "_coachNotes", answer: "" },
        { questionId: "q_goal", answer: "Build muscle" },
      ]);
      expect(merged.sections).toEqual(existing.sections);
      expect(merged._coachNotes).toBe("note");
      expect(merged.q_goal).toBe("Build muscle");
    });

    it("blanks the matching nested entry on a clear, so the clear cannot be undone (review r2 finding 3)", () => {
      // Mixed-shape packet: the coach click-edited an un-submitted packet
      // (nested) and the client saved on iOS (flat). Deleting only the flat key
      // would let `flattenPacketAnswers` fall back to the coach's stale value,
      // so the client's clear would silently not take.
      const existing = {
        sections: [
          {
            sectionId: "sec_basics",
            answers: [
              { questionId: "q_goal", label: "Primary goal", value: "coach value" },
              { questionId: "q_days", label: "Training days", value: "3" },
            ],
          },
        ],
        q_goal: "client value",
      };
      const merged = mergePacketAnswers(existing, [{ questionId: "q_goal", answer: "" }]);

      expect("q_goal" in merged).toBe(false);
      // entry KEPT (the coach's page maps over it), value blanked
      expect(merged.sections).toEqual([
        {
          sectionId: "sec_basics",
          answers: [
            { questionId: "q_goal", label: "Primary goal", value: "" },
            { questionId: "q_days", label: "Training days", value: "3" },
          ],
        },
      ]);
      // and the clear is now what every reader sees
      expect(flattenPacketAnswers(merged)).toEqual({ q_days: "3" });
      // input not mutated
      expect(existing.sections[0].answers[0].value).toBe("coach value");
    });

    it("leaves `sections` alone when a clear matches nothing nested", () => {
      const existing = { sections: [{ sectionId: "s", answers: [{ questionId: "q_days", value: "3" }] }], q_goal: "x" };
      const merged = mergePacketAnswers(existing, [{ questionId: "q_goal", answer: "" }]);
      expect(merged.sections).toBe(existing.sections);
      // a flat-only packet must not gain a `sections` key
      expect("sections" in mergePacketAnswers({ q_goal: "x" }, [{ questionId: "q_goal", answer: "" }])).toBe(false);
    });

    it("treats a whitespace-only answer as a clear", () => {
      expect(mergePacketAnswers({ q_goal: "Lose fat" }, [{ questionId: "q_goal", answer: " " }])).toEqual({});
    });

    it("starts from {} when there is nothing stored yet", () => {
      expect(mergePacketAnswers(null, [{ questionId: "a", answer: "1" }])).toEqual({ a: "1" });
    });
  });

  describe("packetAnswerItems", () => {
    it("keeps blanks, unlike flattenPacketAnswers", () => {
      const nested = {
        sections: [
          {
            sectionId: "sec_basics",
            answers: [
              { questionId: "q_goal", label: "Primary goal", value: "Lose fat" },
              { questionId: "q_days", label: "Training days", value: "" },
            ],
          },
        ],
      };
      expect(packetAnswerItems(nested)).toEqual([
        { questionId: "q_goal", answer: "Lose fat" },
        { questionId: "q_days", answer: "" },
      ]);
      expect(flattenPacketAnswers(nested)).toEqual({ q_goal: "Lose fat" });
    });

    it("prefers the nested value over a stale flat key, and skips reserved keys (T-624 r4 finding 1: this is the opposite rule from flattenPacketAnswers, which is flat-over-nested for STORED data)", () => {
      expect(
        packetAnswerItems({
          sections: [{ answers: [{ questionId: "q_goal", value: "new" }] }],
          q_goal: "old",
          _savedAt: 1,
        })
      ).toEqual([{ questionId: "q_goal", answer: "new" }]);
    });

    it("returns [] for null or garbage", () => {
      expect(packetAnswerItems(null)).toEqual([]);
      expect(packetAnswerItems("nope")).toEqual([]);
      expect(packetAnswerItems([])).toEqual([]);
    });
  });

  describe("mergePacketSubmission", () => {
    it("keeps answers the submitted payload never rendered (review r3 finding 1)", () => {
      // The client answered q_goal / q_days / q_dropped in the iOS app (flat
      // keys), was refused at submit for an unsigned document, and finishes on
      // the token link — whose form only renders the coach's CURRENT template.
      const stored = { q_goal: "Lose fat", q_days: "4", q_dropped: "still relevant" };
      const submitted = {
        sections: [
          {
            sectionId: "sec_basics",
            sectionTitle: "Basics",
            answers: [
              { questionId: "q_goal", label: "Primary goal", value: "Lose fat" },
              { questionId: "q_days", label: "Training days", value: "5" },
            ],
          },
        ],
      };
      const merged = mergePacketSubmission(stored, submitted);

      expect(merged.q_dropped).toBe("still relevant");
      expect(merged.q_days).toBe("5");
      expect(merged.sections).toEqual(submitted.sections);
      expect(flattenPacketAnswers(merged)).toEqual({
        q_goal: "Lose fat",
        q_days: "5",
        q_dropped: "still relevant",
      });
    });

    it("lets the submitted payload clear an answer it rendered empty", () => {
      const merged = mergePacketSubmission(
        { q_goal: "Lose fat", q_days: "4" },
        {
          sections: [
            {
              answers: [
                { questionId: "q_goal", label: "Primary goal", value: "" },
                { questionId: "q_days", label: "Training days", value: "4" },
              ],
            },
          ],
        }
      );
      expect("q_goal" in merged).toBe(false);
      expect(flattenPacketAnswers(merged)).toEqual({ q_days: "4" });
    });

    it("replaces the structural keys the payload carries and keeps the ones it does not", () => {
      const stored = {
        sections: [{ sectionId: "old", answers: [{ questionId: "q_goal", value: "old" }] }],
        _coachNotes: "SYNTHETIC note",
        q_goal: "old",
      };
      const merged = mergePacketSubmission(stored, {
        sections: [{ sectionId: "new", answers: [{ questionId: "q_goal", label: "G", value: "new" }] }],
      });
      expect(merged.sections).toEqual([
        { sectionId: "new", answers: [{ questionId: "q_goal", label: "G", value: "new" }] },
      ]);
      expect(merged._coachNotes).toBe("SYNTHETIC note");
      // the flat key follows the edit, or the stale one would outrank it on read
      expect(merged.q_goal).toBe("new");
      // input not mutated
      expect(stored.sections[0].sectionId).toBe("old");
    });

    it("starts from the payload when nothing is stored yet", () => {
      const submitted = {
        sections: [{ answers: [{ questionId: "q_goal", label: "G", value: "Lose fat" }] }],
      };
      expect(mergePacketSubmission(null, submitted)).toEqual({
        q_goal: "Lose fat",
        sections: submitted.sections,
      });
    });

    it("a coach's review edit sticks even though the caller's payload still carries the stale flat key (T-624 r4 finding 1) — review-session.tsx's `answers` state starts from the whole stored formAnswers and only mutates `sections`, so the payload it sends is `{ ...stored, sections: [edited] }`", () => {
      const stored = {
        q_goal: "Lose fat",
        sections: [
          { sectionId: "sec_basics", answers: [{ questionId: "q_goal", label: "Primary goal", value: "Lose fat" }] },
        ],
      };
      // Exactly what review-session.tsx's commitAnswer produces: spread the
      // previous state (which still carries the stale flat key) and replace
      // only `sections` with the coach's edit.
      const submitted = {
        ...stored,
        sections: [
          { sectionId: "sec_basics", answers: [{ questionId: "q_goal", label: "Primary goal", value: "Build muscle" }] },
        ],
      };

      const merged = mergePacketSubmission(stored, submitted);

      // Edit direction: the coach's new nested value wins, not the carried-over
      // stale flat key — the client's app (which reads the flat key) must see
      // the correction, not the pre-edit answer forever.
      expect(merged.q_goal).toBe("Build muscle");
      expect(flattenPacketAnswers(merged)).toEqual({ q_goal: "Build muscle" });
    });

    it("clear direction of the same bug: a coach blanking an answer through the mixed payload actually clears it, instead of the stale flat key winning", () => {
      const stored = {
        q_goal: "Lose fat",
        sections: [
          { sectionId: "sec_basics", answers: [{ questionId: "q_goal", label: "Primary goal", value: "Lose fat" }] },
        ],
      };
      // The coach blanks the field; the payload still carries the old flat key
      // because review-session.tsx spreads the previous `answers` state.
      const submitted = {
        ...stored,
        sections: [
          { sectionId: "sec_basics", answers: [{ questionId: "q_goal", label: "Primary goal", value: "" }] },
        ],
      };

      const merged = mergePacketSubmission(stored, submitted);

      expect("q_goal" in merged).toBe(false);
      expect(flattenPacketAnswers(merged)).toEqual({});
      // the blankNestedAnswers path ran: the nested entry the coach cleared is
      // kept with an empty value, not silently left at the old one, and the
      // final `sections` is the payload's own (already blank) copy.
      expect(
        (merged.sections as { answers: { questionId: string; value: string }[] }[])[0].answers[0].value
      ).toBe("");
    });
  });

  describe("normalizeAnswerInput", () => {
    it("accepts the array form and keeps explicit clears", () => {
      expect(
        normalizeAnswerInput([
          { questionId: "a", answer: "1" },
          { questionId: "b", answer: "" },
        ])
      ).toEqual([
        { questionId: "a", answer: "1" },
        { questionId: "b", answer: "" },
      ]);
    });

    it("accepts the legacy object form", () => {
      expect(normalizeAnswerInput({ a: "1", b: 2 })).toEqual([
        { questionId: "a", answer: "1" },
        { questionId: "b", answer: "2" },
      ]);
    });

    it("drops array entries with no questionId or no answer", () => {
      expect(
        normalizeAnswerInput([
          { answer: "orphan" },
          { questionId: "", answer: "empty id" },
          { questionId: "ok" },
          null,
          "x",
          { questionId: "good", answer: "keep" },
        ])
      ).toEqual([{ questionId: "good", answer: "keep" }]);
    });

    it("returns null for anything that is not an array or object", () => {
      expect(normalizeAnswerInput(null)).toBeNull();
      expect(normalizeAnswerInput(undefined)).toBeNull();
      expect(normalizeAnswerInput("answers")).toBeNull();
      expect(normalizeAnswerInput(7)).toBeNull();
    });
  });

  describe("clientIntakeUpdateData", () => {
    it("parses numbers and clears numeric columns on an empty answer", () => {
      expect(
        clientIntakeUpdateData([
          { questionId: "bodyweightLbs", answer: "175" },
          { questionId: "trainingDaysPerWeek", answer: "4" },
        ])
      ).toEqual({ bodyweightLbs: 175, trainingDaysPerWeek: 4 });

      // The pre-T-624 route did parseFloat("") -> NaN and skipped the field,
      // so a cleared number never reached the database.
      expect(clientIntakeUpdateData([{ questionId: "bodyweightLbs", answer: "" }])).toEqual({
        bodyweightLbs: null,
      });
      expect(clientIntakeUpdateData([{ questionId: "ageYears", answer: "  " }])).toEqual({
        ageYears: null,
      });
    });

    it("clears string columns on an empty answer and ignores unknown ids", () => {
      expect(clientIntakeUpdateData([{ questionId: "injuries", answer: "" }])).toEqual({
        injuries: null,
      });
      expect(clientIntakeUpdateData([{ questionId: "injuries", answer: "knee" }])).toEqual({
        injuries: "knee",
      });
      expect(clientIntakeUpdateData([{ questionId: "notAColumn", answer: "x" }])).toEqual({});
      expect(clientIntakeUpdateData([{ questionId: "status", answer: "COMPLETED" }])).toEqual({});
    });

    it("still ignores non-numeric junk for numeric columns", () => {
      expect(clientIntakeUpdateData([{ questionId: "heightInches", answer: "tall" }])).toEqual({});
    });
  });

  describe("planClientIntakeUpdate", () => {
    it("reports the ids it refused instead of dropping them silently (review finding 1)", () => {
      // "." is typeable on the iOS decimal pad. The old code dropped it from the
      // update while the guard saw a non-empty string, so COMPLETED was written
      // with the column still null.
      const plan = planClientIntakeUpdate([
        { questionId: "heightInches", answer: "." },
        { questionId: "trainingDaysPerWeek", answer: "many" },
        { questionId: "bodyweightLbs", answer: "175" },
      ]);
      expect(plan.data).toEqual({ bodyweightLbs: 175 });
      expect(plan.refusedQuestionIds).toEqual(["heightInches", "trainingDaysPerWeek"]);
    });

    it("refuses a value that parses but cannot be stored (review r2 finding 1)", () => {
      // `parseFloat("1e999")` is Infinity, not NaN: an isNaN-only check let it
      // through as a finite-looking answer, and Prisma then either 500s or
      // drops it — the r1 BLOCKER again. `parseInt` overflows a Postgres
      // `integer` the same way.
      const plan = planClientIntakeUpdate([
        { questionId: "bodyweightLbs", answer: "1e999" },
        { questionId: "heightInches", answer: "-1e999" },
        { questionId: "ageYears", answer: "99999999999" },
        { questionId: "trainingDaysPerWeek", answer: "-99999999999" },
      ]);
      expect(plan.data).toEqual({});
      expect(plan.refusedQuestionIds).toEqual([
        "bodyweightLbs", "heightInches", "ageYears", "trainingDaysPerWeek",
      ]);
      // the boundary itself is still storable
      expect(planClientIntakeUpdate([{ questionId: "ageYears", answer: "2147483647" }])).toEqual({
        data: { ageYears: 2147483647 },
        refusedQuestionIds: [],
      });
    });

    it("refuses nothing for clears, valid numbers and strings", () => {
      const plan = planClientIntakeUpdate([
        { questionId: "heightInches", answer: "" },
        { questionId: "ageYears", answer: "28" },
        { questionId: "injuries", answer: "  " },
        { questionId: "notAColumn", answer: "." },
      ]);
      expect(plan.data).toEqual({ heightInches: null, ageYears: 28, injuries: null });
      expect(plan.refusedQuestionIds).toEqual([]);
    });

    it("projected back through clientIntakeToAnswerMap, a refused value never looks answered", () => {
      const row = { heightInches: null, gender: "Male" };
      const plan = planClientIntakeUpdate([{ questionId: "heightInches", answer: "." }]);
      const effective = clientIntakeToAnswerMap({ ...row, ...plan.data });
      expect(missingRequiredAnswers(CLIENT_INTAKE_TEMPLATE.sections, effective)).toContain(
        "heightInches"
      );
    });
  });

  describe("unsignedDocumentIds", () => {
    it("is the one signed-document predicate both submit surfaces use", () => {
      const documents = [{ id: "d1" }, { id: "d2" }];
      expect(unsignedDocumentIds(documents, ["d1"])).toEqual(["d2"]);
      expect(unsignedDocumentIds(documents, ["d1", "d2"])).toEqual([]);
      expect(unsignedDocumentIds([], [])).toEqual([]);
      // a signature for a document that is not on this packet signs nothing
      expect(unsignedDocumentIds(documents, ["other"])).toEqual(["d1", "d2"]);
    });
  });

  describe("isBlank", () => {
    it("is the one predicate every read and write path uses", () => {
      expect(isBlank(null)).toBe(true);
      expect(isBlank(undefined)).toBe(true);
      expect(isBlank("")).toBe(true);
      expect(isBlank("   ")).toBe(true);
      expect(isBlank(" \n\t ")).toBe(true);
      expect(isBlank("0")).toBe(false);
      expect(isBlank(0)).toBe(false);
      expect(isBlank("x")).toBe(false);
    });

    it("drops a legacy whitespace-only column from the wire", () => {
      // Rows written before T-624 could hold "   " (the old route stored
      // `val || null`). The contract says the wire never carries an empty
      // answer, so the read side has to use the same predicate as the guard.
      const map = clientIntakeToAnswerMap({ gender: "   ", primaryGoal: "Build muscle" });
      expect(map).toEqual({ primaryGoal: "Build muscle" });
      expect(toAnswersArray({ a: "   ", b: "ok" })).toEqual([{ questionId: "b", answer: "ok" }]);
      expect(missingRequiredAnswers(CLIENT_INTAKE_TEMPLATE.sections, map)).toContain("gender");
    });
  });

  describe("clientIntakeToAnswerMap / toAnswersArray", () => {
    it("keeps the wire field order and omits empty columns", () => {
      const map = clientIntakeToAnswerMap({
        id: "ci_1",
        status: "IN_PROGRESS",
        bodyweightLbs: 175,
        heightInches: null,
        ageYears: 28,
        gender: "Male",
        injuries: "",
      });
      expect(toAnswersArray(map)).toEqual([
        { questionId: "bodyweightLbs", answer: "175" },
        { questionId: "ageYears", answer: "28" },
        { questionId: "gender", answer: "Male" },
      ]);
    });

    it("never emits an empty answer", () => {
      expect(toAnswersArray({ a: "1", b: "" })).toEqual([{ questionId: "a", answer: "1" }]);
    });
  });

  describe("resolveIntakeTemplate", () => {
    it("falls back to the built-in template when the coach has none", () => {
      expect(resolveIntakeTemplate(null)).toBe(CLIENT_INTAKE_TEMPLATE);
      expect(resolveIntakeTemplate(undefined)).toBe(CLIENT_INTAKE_TEMPLATE);
    });

    it("wraps a coach row and never yields a non-array sections", () => {
      expect(resolveIntakeTemplate({ id: "tpl_1", sections: [{ id: "s" }] })).toMatchObject({
        id: "tpl_1",
        name: "Intake Questionnaire",
      });
      expect(resolveIntakeTemplate({ id: "tpl_1", sections: "garbage" }).sections).toEqual([]);
    });
  });
});
