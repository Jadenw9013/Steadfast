# AI Coach live-launch packet authoring

This directory defines the versioned evidence-index workflow for a future live AI Coach release. It does not authorize or activate live coaching. The only included packet is `testOnly: true`, contains explicit `REQUIRED HUMAN DECISION` fields, has no artifact bindings, and is expected to fail the readiness drill.

## Immutable authoring workflow

1. Copy `live-launch-packet.template.v1.json` to a new versioned filename. Never edit a packet version after it has been registered. Allocate the exact application release ID, AI Coach engine version, and reviewed jurisdictions.
2. Re-run and digest-check every source record. A changed worksheet, ticket, evidence record, build, provider configuration, or policy artifact requires a new packet version; do not repair a digest in place.
3. Have a qualified nutrition professional complete D01–D12 in the HQ review worksheet. Each decision record must bind its evidence links, supported population and exclusions, risks, artifact fields and units, reviewer identity/qualifications, legal sign-off where applicable, and required post-approval tests. Do not infer blank values from public framework descriptions.
4. Author new server-owned T-1005 artifact versions as DRAFT. Bind exactly one non-synthetic policy, food catalog, exercise catalog, evidence registry, and escalation-template version by immutable ID/version/digest. The policy must reference the other four exact versions and all references must validate. Never accept model-supplied facts, IDs, replacements, or approval content.
5. Attach current, revision-bound engineering evidence for T-1005 through T-1010. Separately attach witnessed staging rollback evidence, an approved real-provider evaluation, and full-Xcode build/test evidence. Raw prompts, model traces, client facts, secrets, and vendor payloads do not belong in the packet.
6. Obtain externally signed, expiring records for every approval category. Store only the accountable reviewer metadata, scope, record reference, digest, signature reference, and expiry in the packet. The authoritative signed records remain in the approved records system.
7. Set `testOnly` to `false` only for a genuine launch packet after all placeholders are removed. Run the draft check, readiness check, isolated PostgreSQL tests, complete release-evidence harness, disposable migration replay, web build, and full-Xcode validator for the exact revisions.
8. Bind the final constrained-provider configuration (vendor Anthropic, pinned `apiBaseUrl`), data-minimization settings, prompt-contract allowlists, approved SLO/alert/token/spend limits, named runbook records, and every legally approved discovery/consent/privacy/navigation/pricing string under `runtimeConfiguration`. The client applications contain no fallback live-launch copy. Every approval and evidence record must bind `runtimeConfigurationDigest`, and consent binds the entire immutable discovery configuration.
9. A separately authorized governance actor may register and approve the exact packet through the server repository. Approval alone enables nothing. The sole CLI activation path revalidates the database packet and artifacts, creates a server-selected active release, and enables operational scopes atomically. There is no activation HTTP route or environment/flag selector.
10. Revoke rather than mutate. Revocation/deactivation is one-way, append-only, hides discovery, and disables every AI Coach operational scope. Any replacement requires a new packet and complete evidence cycle.

Run the authoring and fail-closed checks:

```sh
pnpm run ai-coach:launch-packet:check
pnpm run ai-coach:launch-readiness-drill
```

The first command must pass for the included draft. The second command passes only when the included draft is rejected for live readiness. To assess a future candidate directly, run:

```sh
pnpm exec tsx scripts/validate-ai-coach-live-launch-packet.ts \
  --readiness docs/ai-coach/approval/<candidate>.json
```

Do not register or approve a packet merely because this file-level check passes. Database lifecycle rules, exact live-artifact loading, governance grants, operational controls, and the production operation gate independently fail closed.
