# AI Coach governed staging release runbook v1

This runbook automates verification, not deployment authority. No command here targets production or enables a public feature by itself.

1. Produce an immutable candidate packet with exact application, engine, runtime-configuration, artifact, source, approval, and evidence digests.
2. Run `DATABASE_URL='<staging database>' pnpm run ai-coach:staging-preflight -- docs/ai-coach/approval/<candidate>.json`.
3. Deploy the exact reviewed web and iOS revisions using the organization's approved staging pipeline: **REQUIRED INFRASTRUCTURE INPUT**.
4. Run the real-provider synthetic evaluation only after provider privacy/security approval. Externally sign the evidence digest.
5. From a full-Xcode CI runner, run `bash scripts/validate-ai-coach-release.sh --require-xcode` in `ios-steadfast`; attach the signed result to the exact revision.
6. A named witness runs the activation, alert, kill-switch, discovery-hide, rollback, export, and deletion drills. Record timestamps and immutable output digests: **REQUIRED HUMAN WITNESS**.
7. Deactivate staging. Any replacement packet must start a new drill.

Activation in staging uses the same command and database guard as production. A test-only packet cannot pass it. A successful drill is evidence only and has no authority in another environment.
