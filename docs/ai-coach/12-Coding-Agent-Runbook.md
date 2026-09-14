# Coding-agent entry instructions

Use this pack as the new feature brief. Earlier `Steadfast-AI-Coach-MVP-Plan.md`, `Steadfast-AI-Coach-Redesign.md` and the pasted other-AI discussion are historical context, not additional requirements. The original uploaded company-role guides are useful prompts but contain stale implementation facts. Do not merge all of their incompatible instructions into the build.

## Read and establish the branch

1. Read [00](00-Start-Here.md), [03](03-Codebase-Audit.md), [05](05-API-and-State-Contracts.md) and [08](08-Implementation-Backlog.md). Read the relevant domain document before each slice.
2. Inspect the working tree, branch and current commit. This audit used `bda25ea4673b47ccc4c302cb6becbcbad0842d3a`. Preserve unrelated user changes and revalidate findings against any newer commit. Create an isolated branch/worktree when useful.
3. Read current `CLAUDE.md`, applicable `AGENTS.md` if present, `.claude/skills/steadfast-patterns/SKILL.md`, and version-specific skills. Read the authoritative design MASTER and relevant overrides before UI work. The graphify report referenced in this snapshot is absent; do not invent its contents.
4. Check installed dependencies and test configuration before running commands. This planning session had no dependencies installed and did not run application tests. No passing baseline is supplied.

The existing stack is Next.js/TypeScript/Zod/Prisma with Clerk, private storage and web/API consumers. Reuse it. Do not introduce a Python backend, vector database, orchestration framework or a new component library without a demonstrated need and the project's applicable dependency process.

## F00: reconcile contradictory instructions

Make a small documentation-first change establishing one supported workflow. Resolve these observed contradictions rather than silently following a convenient paragraph:

- pnpm is required while example scripts and the release script use npm.
- CLAUDE claims no test runner although Vitest and Playwright are configured.
- Migration instructions alternate between `migrate dev`, diff/deploy and `db execute` in CI.
- Old role docs misstate schema counts and uniqueness, treat all mutations as actions despite current REST consumers, and conflict about input/tap sizing and dark mode.
- Intake/dashboard design overrides contain unrelated marketing instructions. Replace them with accurate scoped human and AI page guidance, preserving current visual constraints.

The proposed convention is pnpm, current generated Prisma imports, explicit CoachClient selection, permanent dark mode, 48px minimum tap targets and 16px input text. Thin actions and REST handlers share services. No blanket removal of existing native-compatible APIs. Migration files and the migration ledger are the release source of truth; do not use `db push` or untracked ad-hoc production SQL as the normal workflow.

## Isolated setup and migrations

`prisma.config.ts` and Playwright load `.env.local`. Verify the datasource privately before any operation; never print credentials. A local web server can still point at a remote production database. Integration tests currently require the designated local PostgreSQL test database and explicit opt-in, described in [09](09-Validation-Release-Operations.md).

After confirming an isolated disposable development/test datasource:

1. Install from the existing lockfile with pnpm; record the exact package-manager/runtime versions. Do not casually regenerate the lockfile or upgrade dependencies during a feature slice.
2. Generate the client and run the relevant existing tests to establish the actual baseline. If failure predates the slice, report it accurately and assess whether it blocks that change.
3. Create additive migration SQL using the repository's reconciled, current-Prisma workflow. `migrate dev` requires a suitable isolated development/shadow setup; an explicit reviewed diff workflow is the alternative for the project's Neon constraints. Rehearse from the previous schema and representative synthetic data.
4. Inspect backfills and constraints before applying them. Preview ambiguous relationships, message archives and duplicate version labels; never guess consent, recipients or current providers.
5. Validate/generate and exercise the meaningful transaction tests. Apply reviewed migrations to an authorized deployment environment through the recorded deployment workflow, separately from local preparation.

Verify exact version-specific CLI flags against official documentation before use. This pack intentionally contains no ready-to-paste command targeting a real datasource. Production reset, destructive backfill and deployment are not part of this planning request.

## First coding request

```text
Use the Steadfast company plan as the new authoritative feature brief.
Begin with F00, then address F01 and F02 in separate bounded slices.
Read the current repository instructions and inspect the actual call paths
before editing. Reconcile drift from audit commit bda25ea4673b47ccc4c302cb6becbcbad0842d3a.

Close the active-account guard gap and coach-controlled account-linking
path. Coach-entered contact details must never grant client-data access.
Cover every legacy/JIT writer; preserve legitimate client-accepted links.
Keep app changes within the selected slice and at most ten files per
sub-slice, including tests and migrations. Use isolated synthetic accounts.

Return changed files, behavioral proof, actual command results, remaining
blockers and rollback behavior. Do not claim tests passed if skipped.
Do not implement live AI prescriptions, run production migrations or
deploy as part of this initial repair request.
```

After foundational repairs, use the same prompt template with the next A-series ID and relevant documents. The dependency graph allows policy/catalog review and synthetic engineering to progress together. Do not let a missing clinical decision turn into an invented default or a silent removal of meal mode.

## Definition of a completed slice

The slice meets its stated outcome, authorization and lifecycle invariants; has meaningful regression evidence at the actual failure boundary; preserves existing human/API consumers; includes migrations and rollback behavior where relevant; reports actual gate results; and keeps unapproved live capabilities disabled.

Use [09](09-Validation-Release-Operations.md) for tests and release controls. A build/lint pass does not validate authorization races, clinical policy, usability or nutritional adequacy. Conversely, do not create tautological tests for low-impact prose changes. Test the risk the slice actually changes.

Stop only the blocked capability. For example, incomplete professional policy blocks live numerical publication but allows synthetic contracts, screens and jobs; an unresolved conversation migration blocks historical sharing but not a focused authorization repair. Finish concrete reviewable work before escalating a decision.
