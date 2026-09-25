# AI Coach referral and pause runbook v1

Status: engineering template only — **NOT APPROVED FOR CLIENT USE**

The deterministic policy may return `HOLD`, `FOCUSED_CLARIFICATION`, or `PAUSE_REFER`. Engineering preserves those outcomes and renders only the exact reviewed escalation-template text bound to the active policy artifacts. It does not author emergency, clinical, referral, diagnostic, or treatment advice.

## Required signed inputs

- Jurisdiction-specific emergency and referral wording: **REQUIRED HUMAN DECISION — legal counsel and qualified reviewer**
- Supported populations, exclusions, and routing criteria: **REQUIRED HUMAN DECISION — qualified nutrition professional and legal counsel**
- Named referral destinations and availability claims: **REQUIRED HUMAN DECISION — operational owner and legal counsel**
- Monitoring/non-monitoring disclosure: **REQUIRED HUMAN DECISION — product governance and legal counsel**
- Accessibility/localization review for every approved locale: **REQUIRED HUMAN DECISION — product/accessibility owner**

## Mechanical behavior

- `HOLD`: no candidate becomes active; the current accepted plan remains unchanged if still independently valid.
- `FOCUSED_CLARIFICATION`: only a server-owned allowed clarification ID may be selected; no free-form model question is authoritative.
- `PAUSE_REFER`: affected domains remain paused and only a reviewed escalation template may supply the next step.
- Any missing, stale, revoked, incompatible, unsigned, or digest-mismatched artifact or approval fails closed before provider I/O or client exposure.
- This service does not claim continuous monitoring. Operational responders must not imply that a model or staff member saw a client message unless a separate approved process proves it.

No placeholder in this document may be copied into client-facing content. Approved wording belongs in immutable escalation/discovery artifacts and must be included in the live-launch packet digest.
