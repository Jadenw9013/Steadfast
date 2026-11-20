# Account Entry

Routes: `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]`, `/account`.

- One public entry: `/sign-in`, with Clerk's supported `withSignUp` flow. Let Clerk
  retain email ownership verification, configured social providers, password recovery,
  MFA, bot protections and session tasks. Do not add an unauthenticated email lookup.
- Centered, single-column shell, maximum 420px, cool charcoal palette from MASTER.
  No split-screen marketing panel, feature pills or second account-choice screen.
- Inputs at least 16px; primary controls 56px high; other tap targets at least 48px.
- Keep email-recovery help available inline. Preserve the medical disclaimer in a
  collapsible disclosure and keep Terms/Privacy links visible.
- Preserve old signup verification/OAuth/ticket routes. Ordinary legacy signup links
  enter the combined flow, retaining a validated return destination.
- Return both signup and signin to the same safe destination. Default `/account`
  resolves the persisted active role, never stale session role metadata. Existing
  client layout owns the unfinished-questionnaire gate; do not reset completion.
- Client invites have one continue action. Preserve the token through authentication
  and keep the existing consent, ownership and current-provider checks on redemption.
- Never assert a coach connection from an email match or suppress a real connection
  error by creating another coaching request or replacing an established identity.
