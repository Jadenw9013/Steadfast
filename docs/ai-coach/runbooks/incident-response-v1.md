# AI Coach incident response runbook v1

Status: engineering template only — **NOT APPROVED FOR LIVE USE**  
Authority: the current signed live-launch packet and named operational owner  
Client-facing wording: **REQUIRED HUMAN DECISION**

This runbook defines mechanical containment without inventing clinical, legal, emergency, referral, or service-level decisions. A provider, model, feature flag, environment variable, client, or admin route cannot authorize or restore AI Coach.

## Trigger and ownership record

- Named incident commander/on-call owner: **REQUIRED HUMAN DECISION**
- Paging destination and escalation timer: **REQUIRED HUMAN DECISION**
- Approved SLO/alert thresholds: supplied by the packet's `runtimeConfiguration.operations` and bound to its digest.
- Approved incident classification and regulator/customer notification rules: **REQUIRED HUMAN DECISION — legal/privacy**
- Approved client notification wording: **REQUIRED HUMAN DECISION — legal/product/referral reviewer**

## Containment

1. Record an incident reference in the approved incident system.
2. Run the governed deactivation command with a governance actor holding `DEACTIVATE_LIVE_LAUNCH`. This atomically deactivates the server-selected release and disables generation, provider, finalization, acceptance, and artifact-publication scopes.
3. Verify that public discovery returns not found, native discovery returns nil, and all production operation checks fail closed.
4. Preserve aggregate audit/evidence. Do not copy raw prompts, traces, intake answers, health details, credentials, or provider payloads into incident chat or tickets.
5. Follow the approved client/referral wording record. The engineering template supplies none.

```sh
DATABASE_URL='<approved database connection>' pnpm run ai-coach:deactivate -- \
  --actor-user-id '<governance-user-id>' \
  --signed-activation-ref '<signed-incident-authorization-record>' \
  --reason-code '<approved-reason-code>' \
  --reason '<approved auditable reason>' \
  --incident-reference '<incident-record-id>'
```

## Recovery

Recovery is a new governed activation, never a control toggle. Root cause, corrected immutable artifact/configuration versions, regression evidence, staging witness, and replacement signatures must be attached to a new packet when any bound input changed. The original activation is one-way deactivated.

Post-incident review owner, deadline, retention, and distribution: **REQUIRED HUMAN DECISION**.
