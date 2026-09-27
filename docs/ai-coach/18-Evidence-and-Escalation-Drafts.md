# 18. Evidence registry and escalation templates — DRAFT_UNSIGNED handover

Two of the five artifacts `loadLiveArtifactSetForLaunchValidation` requires existed only as synthetic
fixtures, and a synthetic artifact is refused at launch by design, so no v1 launch was representable. This
document is the reviewer's handover for the drafts that close that gap:

| Artifact | File | Loader |
|---|---|---|
| `EVIDENCE_REGISTRY` | `lib/ai-coach/artifacts/drafts/evidence-registry.draft-unsigned.v1.json` | `lib/ai-coach/artifacts/drafts/evidence-registry.ts` |
| `ESCALATION_TEMPLATES` | `lib/ai-coach/artifacts/drafts/escalation-templates.draft-unsigned.v1.json` | `lib/ai-coach/artifacts/drafts/escalation-templates.ts` |

Both ship `DRAFT_UNSIGNED` with every record `PROPOSED`. Both loaders refuse to run when
`NODE_ENV === "production"`. Neither is imported by anything under `app/` or `components/`, and neither is
registered anywhere: no caller exists, deliberately, because G01 and G03 have not happened.

> **Engineering wrote the structure. It did not write the content, and it is not qualified to.**
> Escalation copy is the sentence a real person reads when the system stops. Evidence rules decide when
> evidence is sufficient to act on. Both are clinical and legal judgment. Every string below is a
> **candidate** for Jaden (RD, CPT) and legal counsel to correct or replace.

---

## 1. What the reviewer must do

Nine evidence claims and fifteen escalation templates. Section 4 is the list.

Nothing in either file asserts an external authority that Steadfast verified, because Steadfast verified
none of it:

- No evidence claim states what a source says. Each one records that the **draft policy bundle already
  cites that source** (`reviewMetadata.proposalProvenance` in
  `policy-bundle-nutrition.draft-unsigned.v1.json`, written by T-2032/T-2039) and that nobody has checked
  it. A unit test re-derives every `sourceUrl` and every rule binding from the bundle and fails if this file
  introduces either, so inventing a citation here is structurally impossible rather than a matter of care
  (`board/evidence/T-2035.md` is why that guard exists).
- `reviewer.name` is the literal `UNREVIEWED_DRAFT_NO_REVIEWER_ASSIGNED` and `reviewer.qualifications` is
  `["UNREVIEWED_DRAFT_NOT_A_QUALIFICATION"]` on every claim. No name and no qualification is asserted.
- `reviewDate` is the draft **preparation** date on every claim, not a review date. The schema field name
  asserts a review it cannot express otherwise; **T-2020** already tracks that naming problem across every
  artifact kind, because the field sits inside `artifactContentDigest`.
- `geographies` is `["PENDING_LEGAL_AND_CLINICAL_REVIEW.NO_GEOGRAPHY_CLEARED"]` on every template. No
  jurisdiction has cleared this copy.

---

## 2. Values deliberately left absent, so the system fails closed

The T-2039 pattern: an absent value that produces a named refusal beats a present value somebody guessed.

| Left absent | Consequence today | Who decides |
|---|---|---|
| Strength effort copy (`TRAINING.EFFORT.STRENGTH.V1`) | `resolveTrainingParameters` returns `TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE`; no session composes | RD — effort is a dose (RPE/RIR) |
| Cardio effort copy (`TRAINING.EFFORT.CARDIO.V1`) | same | RD — same reason |
| Prescription explanation copy | `resolveReviewedPrescriptionExplanationTexts` returns an empty list, so `computePrescription` fails closed to `PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE` | RD, then counsel |
| Any threshold, dose, rate or duration in client copy | not expressible: a unit test fails on a digit or a spelled-out number in `nextStepText`/`nonMonitoringStatement` | RD |
| Evidence for `NUTRITION_EVIDENCE_RULE` | see §3 | RD |

The draft bundle still names the two `TRAINING.EFFORT.*` ids in `explanationTemplateIds`. That is
intentional: the bundle declares what it *needs*, this artifact supplies what has been *reviewed*, and the
resolver's own lookup is what refuses.

---

## 3. The one judgment call that went the other way, and why

`CLAIM.PENDING.NUTRITION_EVIDENCE_RULE` exists and supplies no evidence. Its own text says so in capitals.

The bundle lists `NUTRITION_EVIDENCE_RULE` in `evidenceRuleIds`, and `assertEvidenceRulesHaveClaims`
(`lib/ai-coach/autonomy/gate.ts`) throws `ARTIFACT_INCOMPATIBLE` **inside the gate transaction** when a
policy evidence rule has no covering claim. That is a 503 with no `AiAutonomyGateDecision` row for every
client — the exact failure T-2033 removed from `resolveNextActionTemplateId` — and, critically, nothing on
the publication path catches it: `assertArtifactSetReferences` does not check `evidenceRuleIds` coverage, so
a signed bundle with the gap would publish cleanly and then fail every request.

So the placeholder is present and the omission is loud instead of absent and silent. **The reviewer must
either supply real evidence for this rule or remove the rule from the bundle before signing.** Signing the
file as it stands would put a record reading "NO EVIDENCE HAS BEEN SUPPLIED" into a live artifact.

---

## 4. Exactly what to review

### 4.1 Evidence claims (9)

Eight claims are pointers to sources the draft policy bundle already cites. For each one: open the
`sourceUrl`, read the locator recorded in `limitations`, and then confirm, correct or strike the record.

| Claim id | Source recorded by the bundle | Backs |
|---|---|---|
| `CLAIM.NASEM.ENERGY.2023.TABLE_5_16` | NASEM DRI for Energy | adult energy-estimation coefficients |
| `CLAIM.NASEM.ENERGY.2023.INPUT_RANGES` | NASEM DRI for Energy | supported input ranges for that estimation |
| `CLAIM.NASEM.DRI.MACRONUTRIENTS.AMDR` | NASEM DRI collection (NIH ODS index) | macronutrient distribution ranges |
| `CLAIM.NASEM.DRI.ATWATER_ENERGY_DENSITY` | NASEM DRI collection (NIH ODS index) | macronutrient-to-energy conversion |
| `CLAIM.NASEM.DRI.PROTEIN.BASELINE` | NASEM DRI collection (NIH ODS index) | protein for no regular training |
| `CLAIM.ACSM.AND.PROTEIN.ACTIVE_ADULT` | AND/DC/ACSM joint position (PubMed) | protein for occasional training |
| `CLAIM.ISSN.MORTON.PROTEIN.RESISTANCE_TRAINING` | Morton meta-analysis (PubMed) | protein for regular resistance training |
| `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | **none — a Steadfast engineering proposal** | draft training session-structure parameters |
| `CLAIM.PENDING.NUTRITION_EVIDENCE_RULE` | **none — nothing supplied** | the bundle's nutrition evidence rule (§3) |

The last two are not evidence and say so. Striking `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` means striking
the eleven training parameters that depend on it.

### 4.2 Escalation templates (15)

Read every `nextStepText`. They are ordinary English sentences and the whole review is reading them.

| Template id | Fires when | Outcome |
|---|---|---|
| `ESCALATION.PLAN.READY.V1` | `GATE_APPROVED` | plan released |
| `ESCALATION.SERVICE.UNAVAILABLE.V1` | `GATE_AUTHORITY_UNAVAILABLE` | PAUSE_REFER |
| `ESCALATION.SCOPE.OUT_OF_SCOPE.V1` | `GATE_OUT_OF_SCOPE` | PAUSE_REFER |
| `ESCALATION.SAFETY.RESTRICTED.V1` | `GATE_SAFETY_RESTRICTED` | PAUSE_REFER |
| `ESCALATION.INTAKE.INCOMPLETE.V1` | `GATE_REQUIRED_INPUT_MISSING` | FOCUSED_CLARIFICATION |
| `ESCALATION.INTAKE.UNRECOGNISED.V1` | `GATE_REQUIRED_INPUT_INVALID` | FOCUSED_CLARIFICATION |
| `ESCALATION.NUTRITION.TARGET.OUT_OF_SCOPE.V1` | prescription out-of-scope class | PAUSE_REFER |
| `ESCALATION.NUTRITION.TARGET.NOT_READY.V1` | prescription policy-not-ready class | HOLD |
| `ESCALATION.NUTRITION.TARGET.NEEDS_ANSWERS.V1` | prescription client-fixable class | FOCUSED_CLARIFICATION |
| `ESCALATION.NUTRITION.SAFETY.UNAVAILABLE.V1` | `GATE_NUTRITION_SAFETY_UNAVAILABLE` | PAUSE_REFER |
| `ESCALATION.NUTRITION.SAFETY.PAUSE_REFER.V1` | screening flag/unknown, any contraindication | PAUSE_REFER |
| `ESCALATION.NUTRITION.SAFETY.HOLD.V1` | energy floor, loss-rate cap, consecutive deficit, missing rate input, unverifiable history | HOLD |
| `ESCALATION.EVIDENCE.NEEDS_INPUT.V1` | `GATE_EVIDENCE_MISSING` | FOCUSED_CLARIFICATION |
| `ESCALATION.EVIDENCE.HOLD.V1` | evidence invalid, insufficient or stale | HOLD |
| `ESCALATION.PLAN.NOT_USABLE.V1` | `GATE_CANDIDATE_INVALID` | HOLD |

**One safety-pause sentence covers screening and all five contraindications** (age, pregnancy/postpartum,
eating-disorder history or concern, type 1 diabetes, cardiac condition). That is a deliberate judgment the
reviewer can overturn: naming which flag fired would tell the client something about their own health that
the service is in no position to state, and the eating-disorder case is the one where that matters most.
The cost is that the same wording serves six quite different situations. Splitting it needs new template ids
**and** a re-binding in `safetyControls`, and the gate's own copy would still be the generic one — worth an
architect ticket rather than an edit here.

### 4.3 Copy rules a test enforces, so corrections must keep them

A correction that breaks one of these turns
`tests/unit/ai-coach-evidence-escalation-drafts.test.ts` red rather than shipping:

- no digit and no spelled-out number anywhere in client-facing copy;
- no wording implying a human is reviewing (`review`, `our team`, `we will`, `someone will`, …) — in v1
  none is, per `board/strategy/ai-coach-v1-autonomy-plan.md`;
- no diagnosis, treatment, therapy or prescribing language;
- no urgency the service cannot back (`urgent`, `immediately`, `emergency`, …);
- one `nonMonitoringStatement`, identical across all fifteen templates.

---

## 5. Structure the reviewer should not have to think about

- **Coverage.** `resolveNextActionTemplateId` resolves a template for every evaluation, approvals included,
  and throws when neither the whole ordered reason-code set nor the leading `GATE_*` code is covered. The
  set covers every `AutonomyGateReasonCode`, every `PrescriptionReasonCode` (which
  `loadLiveArtifactSetForLaunchValidation` asserts at publication) and every reason code the bundle's
  `safetyControls` can emit.
- **Array order is load-bearing.** The degraded lookup is a `find`, so
  `ESCALATION.NUTRITION.TARGET.OUT_OF_SCOPE.V1` precedes the other two prescription templates: a
  mixed-class set degrades to the most protective copy. A test pins it.
- **The bundle was re-bound.** `escalationTemplateIds`, `safetyControls.screening.escalationTemplateId` and
  all five contraindication bindings pointed at `synthetic-pause-refer-template`, an id that exists only on
  a synthetic artifact and can therefore never satisfy a live launch. They now point at these drafts.
  `synthetic-pause-refer-template` was also removed from `explanationTemplateIds`. No parameter, value or
  rule id in the bundle changed.
- **`pausedDomains` has no runtime reader**, and a test fails if one appears. It has no empty
  representation in the schema either, so `ESCALATION.PLAN.READY.V1` — an approval, where nothing is
  paused — lists all three domains because the schema requires at least one. That is a schema artifact, not
  a claim; giving the schema a way to say "nothing" is an architect change, since the field sits inside
  `artifactContentDigest`.
