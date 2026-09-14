# Evidence, assumptions and real-world gates

This pack combines observed code, cited public sources and proposed design. Multi-agent agreement is not professional validation. No clinical signoff, participant study, deployed-system verification, paid model benchmark or application test execution occurred during this planning work.

## Source hierarchy

Repository evidence is pinned to [commit bda25ea4673b47ccc4c302cb6becbcbad0842d3a](https://github.com/Jadenw9013/Steadfast/tree/bda25ea4673b47ccc4c302cb6becbcbad0842d3a); remote HEAD matched when reviewed. Exact findings and preconditions are in [03](03-Codebase-Audit.md). Uploaded PDFs and role guides were read as product context; they do not override current code facts. Prior plan documents are superseded by this pack.

Clinical and technical implementation must use applicable primary evidence and current official documentation. A population guideline is not an individualized prescription, a vendor description is not an accuracy benchmark, and an inaccessible full paper must not be represented as fully appraised.

## Evidence registry seed

These links seed a maintained registry; they are not the finished reviewed policy. Relevant application limits are stated here and in the linked domain documents.

| Topic | Primary source | Use and limit |
|---|---|---|
| Resistance training | [ACSM 2026 position-stand summary](https://acsm.org/resistance-training-guidelines-update-2026/) | Supports current healthy-adult context and practical individualization. This review used the society summary, not a full appraisal of every underlying study. |
| General activity | [CDC adult activity guidance](https://www.cdc.gov/physical-activity-basics/guidelines/adults.html) | Population destination, not a mandatory first-week dose for every beginner. |
| Energy estimation scope | [NIDDK Body Weight Planner](https://www.niddk.nih.gov/bwp) | Illustrates restricted calculator scope; does not define universal safe intake floors. |
| Resting-energy equation | [Original Mifflin–St Jeor study](https://pubmed.ncbi.nlm.nih.gov/2305711/) | Candidate estimation evidence for qualified review; resting energy is not known individual daily expenditure. Not selected here as a universal method. |
| Food data | [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/), [Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/) | Source records and calculation methods. Verify ingredient/allergen constraints separately; nutrient missingness remains explicit. |
| Food-label arithmetic | [21 CFR 101.9](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.9) | Energy/label conventions support source-aware reconciliation rather than unconditional exact macro-energy equality. |
| Eating concerns | [NIMH eating-disorder information](https://www.nimh.nih.gov/health/publications/eating-disorders) | Relevant concern boundaries; does not validate automated diagnosis or screening. |
| Model reliability | [Anthropic hallucination guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations), [vision guidance](https://platform.claude.com/docs/en/build-with-claude/vision) | Supports bounded, validated use; image input does not establish food weight or remove uncertainty. |
| Supported models | [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) | Check deployment support. The pasted recommendation of Claude 3.5 Sonnet is obsolete; benchmark a supported model rather than copying it. |
| Queue hosting | [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [cron operation](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [function limits](https://vercel.com/docs/functions/limitations) | Verify cadence/duration in the actual deployment; reliability requires application recovery and idempotency. |
| Database queue claims | [PostgreSQL SELECT/locking](https://www.postgresql.org/docs/current/sql-select.html) | Supports bounded queue-style locking. It is not permission to skip required ownership reads. |
| Accessibility | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Basis for actual accessibility verification; code inspection alone does not establish conformance. |
| Market capabilities | Official Cal AI, Fitbod and MacroFactor sources linked in [10](10-Business-and-Pilot.md) | Advertised capabilities checked in this session; no hands-on competitive benchmark or superiority conclusion. |

For every executable clinical rule, add source/date, population, limitation, qualified reviewer, rule IDs, exact parameter units and version. Do not ingest fresh research directly into live recommendations without review. Reassess on evidence changes, incidents, scope changes, model replacement and policy/catalog revisions.

## Privacy and product-scope review

Washington's consumer-health-data statute contains requirements involving collection/sharing, notices, consumer rights, security and processors; whether and how they apply requires review of the actual service and users. [RCW 19.373](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373)

The FTC's Health Breach Notification Rule can apply to certain consumer health products outside HIPAA. Do not infer exemption merely because Steadfast is a wellness app. Map actual data flows and incident duties with an appropriate reviewer. [FTC business guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

FDA general-wellness guidance concerns intended use and risk; describing the app as wellness does not certify it or authorize disease-treatment claims. Review the actual claims and functionality. [FDA guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices)

These are scoped review inputs, not a legal conclusion that the service is compliant, exempt or approved. Avoid sending health answers, photos or free-text reviews to general advertising/session-replay tools. Provider processing, retention, deletion and any model-improvement use need explicit decisions, not assumptions based on having an API key.

## Open-decision register

Owners below are responsibilities to assign to real people. They are not claims that those people have been hired or that decisions are approved. These gates allow coding to proceed with synthetic data while preventing guessed live defaults.

| Gate | Accountable owner | Concrete artifact to supply | Blocks / work that can continue |
|---|---|---|---|
| G01 Clinical policy and population | Qualified nutrition and exercise reviewers; product owner | Versioned policy with applicable methods, numerical limits, inputs, exclusions, restart rules and signed review scope; adjudicated fixtures. | Blocks real numerical prescriptions. A02–A12 synthetic engineering continues. |
| G02 Content adequacy and usability | Domain content owner with qualified review | Reviewed recipe/food/exercise catalog, allergen/coverage limits, nutrient checks, demonstrations/usage rights, supported preferences. | Blocks live use of unreviewed content; schema and fixture composition continue. |
| G03 Privacy, claims and geography | CEO plus appropriately qualified privacy/legal reviewer | Actual data-flow/retention map, provider processing terms, approved claim set, supported country/state list, consent and incident procedure. | Blocks real-data pilot outside approved scope. Configuration defaults closed; no precise geolocation required. |
| G04 Qualified pilot capacity | Operations lead and qualified reviewers | Named capability grants, review protocol, service hours/response target, capacity/enrollment cap, absence/escalation procedure. | Blocks participant-visible initial/intensifying plans without approval. A11 reviewer tooling can be built now. |
| G05 Deployment and model configuration | Backend/AI engineers and operating owner | Verified minute scheduler/duration, model support and benchmark, token/spend/rate caps, measured retry/latency behavior, alert thresholds. | Blocks live generation. No purchase or provisioning performed in this task. |
| G06 Real usability and supervised pilot | Product/research lead plus safety owner | Consented task protocol, actual findings/fixes, predefined cohort metrics and stop rules, reviewed pilot outcomes. | Blocks broader self-service claims/rollout. Fixtures and formative prototypes continue. |
| G07 Existing data migration | Backend/security owner and product owner | Read-only counts/provenance report for assignments/messages/versions; reviewed additive backfill and ambiguous-record handling. | Blocks unsafe migration or historical sharing; focused authorization fixes can ship first. |
| G08 Paid client terms | CEO/business owner and billing engineer | SKU/channel, price test, cancellation/refund/grace, safety-pause/human-transfer access rules and webhook reconciliation tests. | Blocks new paid checkout, not invited pilot entitlements. |
| G09 Broader autonomy | Product, qualified policy and operations owners | Explicit evidence decision to reduce routine human review, retained sampling/incident controls and supported scope. | Blocks automatic transition from supervised pilot to unsupervised scale. |

No unanswered commercial preference changes the defined technical safety boundaries. No missing professional decision authorizes a coding agent to insert plausible numerical values. Resolve each gate by producing its artifact; avoid recurring vague requests to “approve AI safety.”
