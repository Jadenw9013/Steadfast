# Bounded autonomous coaching (v1)

## Decision and scope

This document supersedes the pack's prior assumption that every initial numerical plan and intensifying change waits for mandatory human review. V1 is **bounded autonomous coaching** for generally healthy adults seeking general fitness, basic nutrition and beginner training. It is not clinical care, urgent-health triage, diagnosis, rehabilitation, eating-disorder treatment, pregnancy/postpartum programming, medication guidance or open-ended health chat.

### Candidate public reference frameworks, not product credentials

NASM and ACE public scope-of-practice materials are candidate references for designing the policy bundle's fitness-coaching, program-design, behavior-change and general nutrition-education boundaries. They are not incorporated certification manuals, and Steadfast must not copy proprietary course/manual content or represent itself as NASM/ACE certified, endorsed, licensed or affiliated. The policy owner must separately verify applicable law in each launch jurisdiction and obtain qualified legal/professional review before publication.

The resulting v1 boundary is deliberately narrower than a clinical service: general fitness coaching/program design and general behavior/nutrition education only where applicable law permits. It excludes diagnosis, treatment, rehabilitation, clinical nutrition or medical nutrition therapy, medication or supplement prescribing, and any instruction that overrides a clinician's direction. A client report or request that could require one of those acts selects the reviewed `PAUSE_REFER` path; the model cannot label, resolve or override it.

Candidate public references: [ACE nutrition scope-of-practice guidance](https://www.acefitness.org/resources/pros/expert-articles/6248/nutrition-scope-of-practice-what-you-can-do-as-a-personal-trainer/), [ACE scope FAQ](https://www.acefitness.org/faqs/), [NASM personal-training scope overview](https://www.nasm.org/become-a-personal-trainer), and [NASM nutrition-coaching scope overview](https://www.nasm.org/docs/pdf/nutrition-coaching-scope-of-practice-slides.pdf). These links support boundary review only and do not create a license, endorsement, legal conclusion or permission to use proprietary material.

Professional review moves upstream: qualified owners review and publish versioned policy bundles, curated food/exercise catalogs, contraindication/escalation rules and a compact evidence registry. At runtime, deterministic server services apply those reviewed artifacts. They choose one of four outcomes for each request:

| Outcome                 | Meaning                                                                                                           | May create/activate a candidate?                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `APPROVE_AUTOMATICALLY` | All scope, authority, safety, catalog, constraint and evidence checks pass.                                       | Candidate may be shown; normal client acceptance still rechecks current truth. |
| `HOLD`                  | Continuing the permitted active plan is appropriate, or a material change is not justified.                       | No new material candidate.                                                     |
| `FOCUSED_CLARIFICATION` | A bounded missing or ambiguous input can resolve the decision.                                                    | No candidate until the requested answer passes the same gate.                  |
| `PAUSE_REFER`           | Out of scope, contraindicated, safety-ambiguous, urgent-signaled, policy unavailable/revoked or otherwise unsafe. | No candidate; pause affected domains and give the reviewed next-step template. |

`PAUSE_REFER` is a deterministic product disposition, not a clinical or urgent-health conclusion. The product uses reviewed, location-appropriate template language and never implies continuous monitoring or emergency assessment.

## Authority split

| Actor                   | May do                                                                                                                                                                                                                                                            | Must not do                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                   | Interpret only the current client's language; extract declared preferences/concerns; rank already-eligible catalog options; ask an allowed clarification; explain a validated result.                                                                             | Decide authority, access another client, policy applicability, clinical constants, food facts, contraindications, escalation, evidence sufficiency, constraint exceptions or activation; browse, scrape, retrieve live web content, use arbitrary tools/SQL/shell, or retain cross-client memory. |
| Deterministic service   | Authenticate/authorize; select active artifacts; calculate targets; evaluate eligibility, contraindications, restrictions, limits and evidence sufficiency; validate candidate payloads; select outcome; persist audit records; activate only on current recheck. | Invent a missing policy value, use inactive artifacts, infer absent evidence, or silently downgrade a hold/pause to approval.                                                                                                                                                                     |
| Professional governance | Review, version, publish/revoke bundles/catalogs/evidence claims; own escalation templates; review incidents and sampled outcomes.                                                                                                                                | Make an unbounded per-client runtime override or use a reviewer decision to bypass a failed gate.                                                                                                                                                                                                 |

The model receives a minimized, server-produced decision envelope, not raw policy documents or cross-client data. It returns strict structured output. The server treats every field as untrusted and accepts only references already present in the envelope. Explanations render numbers and reason codes from the validated result; free-form model text cannot create a prescription.

## Required reviewed artifacts

1. **Policy bundle:** immutable ID/version/digest, applicability, required inputs, calculation methods, numerical limits, adjustment/cooldown rules, contraindication and escalation mapping, evidence rules, explanation template IDs, effective/revoked state, named qualified owners and review record. Its review record identifies any public framework references used, jurisdictional/legal review status, source/license classification and an attestation that no proprietary NASM/ACE manual content was copied.
2. **Food and exercise catalogs:** immutable IDs/versions/digests; nutrient/allergen/source facts, recipe feasibility, exercise templates, equipment substitutions and beginner constraints. The model selects only supplied eligible IDs.
3. **Evidence registry:** compact versioned claim records with source URL, claim, population, limitations, professional reviewer, rule IDs and review date. It supports the policy bundle; it is not a retrieval system. V1 has no RAG, vector database, live research or web access.
4. **Escalation templates:** reviewed reason-code-to-next-step mapping, locale/geography applicability, domain pause behavior and non-monitoring language.

No policy, catalog or evidence artifact becomes live solely because a fixture passes tests. Synthetic artifacts remain synthetic-only. Missing, expired, incompatible or revoked artifacts fail closed to `PAUSE_REFER` or `HOLD` as the reviewed rule specifies.

## Deterministic gate order

The service records each check, inputs/versions and reason codes. It evaluates in a fixed order:

1. Verify active account, owned current-client context, entitlement/consent and expected revisions.
2. Load compatible active policy, catalogs, evidence registry and escalation templates by immutable version/digest.
3. Check supported scope, structured contraindications and safety-domain permissions. Any out-of-scope or safety-ambiguous signal prevents generation/activation.
4. Validate required inputs and decide whether a bounded clarification is allowed; otherwise hold or pause/refer.
5. Calculate targets and compose only catalog-backed content. Enforce floors, ceilings, rate/cumulative/cooldown limits, allergens, equipment and combined-workload constraints.
6. Evaluate rule-specific evidence sufficiency and choose hold, clarification or an allowed candidate change class.
7. Validate the whole candidate, its provenance and explanation inputs. The model may rank/phrase only after this allowlist exists; the service validates its structured result again.
8. Persist the outcome and full audit record. At client acceptance, re-run current authority/artifact/safety/revision/window checks atomically before activation.

No model call or network I/O occurs inside a database transaction. A provider error cannot alter the deterministic outcome or make a failed gate pass. A concern extracted from free text may increase caution or trigger a focused clarification; it cannot clear a structured restriction or make a clinical/urgent-health determination.

## Audit and operations

Every request records the client-owned operation ID; policy/catalog/evidence/template/model-prompt versions and digests; redacted/minimized gate inputs; outcome; ordered reason codes; candidate hash when present; validation report; and activation/retry state. Audit records are access-controlled, export/purge-aware and never contain hidden model reasoning or unrelated clients' data.

Monitor artifact revocation, gate failures, outcome distributions, unsafe-attempt rejections, stale activation rejections, provider failures and pause/refer volume. A critical safety, policy or authorization signal disables the affected generation/publication flag and preserves sufficient incident evidence. Governance can sample and investigate outcomes, but cannot make a failing runtime gate approve a plan.

## Implementation and release boundary

The implementation sequence is T-1005 → T-1003 → T-1006 → T-1007 → T-1008 → T-1009 → T-1010, followed only after their release gates by T-1011 (distinct AI Coach discovery and explicit provider choice). These tickets replace the mandatory-review release assumption; T-1004 remains an independent historical reviewer-note privacy fix. Until the sequence and its release evidence are complete, all current synthetic fixtures and default-off flags remain in place. The first implementation ticket is T-1005.

Any eventual T-1011 discovery/onboarding disclosure requires qualified legal review, versioning and jurisdiction applicability before display. It must accurately identify AI fitness/general-nutrition coaching, its medical/clinical exclusions, lack of outcome guarantees and the qualified-healthcare referral path. It must not claim clinical validation, medical supervision, risk-free/legal-immunity status, endorsement, or “backed by PhD research.” A truthful statement that the active policy framework is informed by identified, versioned evidence sources and professionally reviewed policy artifacts is permitted only when those records exist. A disclosure is explanatory copy, never a replacement for deterministic safety gates, consent, applicable law or legal/liability review.
