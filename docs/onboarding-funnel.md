# The onboarding funnel — how a stranger becomes a client

Written 2026-09-23, after onboarding silently dropped real clients twice in two days.
This describes the funnel as a whole, because both failures happened *between* components that
were each individually correct and individually tested.

Design source of truth: **T-978**. Symptom tickets: T-960, T-962, T-963, T-973, T-974, T-976, T-977.

## The one sentence

> A `CoachingRequest` at `consultationStage = ACTIVE` always has either a `CoachClient` row for that
> coach and prospect, or a live, unexpired, **redeemable** invite. Never neither.

`CoachClient` is the roster. It is the only thing that means "this person is my client". Every screen
that claims a relationship exists reads that table, and nothing else.

The invariant has three parts, and conflating them is what produced months of confusion:

| | Statement | Owner |
|---|---|---|
| **I1 — establishment** | Activating a lead never leaves it ACTIVE with neither a roster row nor a redeemable invite | T-978, enforced in one transaction |
| **I2 — decay** | An invite expiring later breaks the sentence legitimately, and must be detected | T-977, a daily check |
| **I3 — teardown** | Removing a client must close the lead, or it reads stranded forever | T-979 |

"Redeemable" is load-bearing. A self-addressed invite satisfies the sentence and still guarantees a
strand, because acceptance refuses when the invite's address is the accepting account's own.

## The shape of the funnel

```
   CREATION                         ACTIVATION                    RELATIONSHIP
   ─────────────────────────        ─────────────────────         ──────────────────
   marketplace web form  ┐
   public REST (iOS)     ├──►  CoachingRequest  ──► activateLead() ──┬──► CoachClient
   manual web Add Lead   │        (a lead)                           │    (the roster)
   manual iOS Add Lead   ┘                                           └──► ClientInvite
                                                                          └─ client accepts ──► CoachClient
```

Four ways in, one way through, two possible ends. The second end is not a failure: an invite is a
legitimate resting state, as long as it is live and redeemable and something is watching it decay.

## Why it broke, twice, and what the shape has to do with it

**Both failures were leaks between components, not faults inside them.**

The first: leads created from the iOS app had their email discarded at the door, because the route's
validation schema didn't declare the field the app sent. Every route test passed. The route was fine.
The funnel leaked between creation and activation, where nothing looked.

The second: the prospect signed up under a different address than the coach was given, so the invite
refused at redemption. Acceptance was fine. Activation was fine. The funnel leaked between them, and
neither side told anyone.

Underneath both: **"activate" was six implementations**, and they disagreed about whether creating a
relationship was part of the job. Three did it, one didn't, and two more could reach ACTIVE through a
stage edit — including a REST route that accepted the stage as a free-form string. All of them wrote
the stage first and the relationship second, with nothing joining the two, so any failure in between
produced a lead that said ACTIVE with nothing behind it.

And the coach could not see any of it, because the lead screen inferred roster membership from
`prospectId`, a field set merely by submitting a request while signed in. The product asserted a
relationship from a proxy instead of reading the relationship.

## The rules that follow

These are general. They are written here because three separate bugs in one evening were the same
mistake wearing different clothes.

1. **A state that implies a relationship is written in the same transaction as the relationship.**
   Not "immediately after". In the same transaction.
2. **A screen never asserts a relationship exists from a proxy field.** It reads the relationship table.
   `prospectId`, an email match and a phone match are all proxies.
3. **One writer per state transition.** If two functions can set the same state, they will eventually
   disagree, and the disagreement will be invisible.
4. **Test the funnel, not the routes.** Every creation path crossed with every activation path,
   asserting the invariant against the database. Both incidents occurred in a repo where every route
   test passed, and route tests structurally cannot catch a leak between routes.
5. **Detect the end state, not the causes.** Causes are unbounded; the stranded signature is one query.
   Whatever breaks next produces the same signature.
6. **A refusal that writes nothing beats a success that writes half.** Activation refuses when there is
   no address on file (Jaden, 2026-09-23) rather than producing the stranded state it exists to prevent.

## Two lineages, deliberately

The deployed line and the sprint branch are different products here, and this is intentional, not drift.

**Deployed** creates the roster row itself the moment it matches an account by email, with no acceptance
step. **The sprint branch** never does: only the client accepting an invite creates the relationship.
That is CB01 — an address a coach types into a form must never by itself grant access to someone's
existing account.

T-978 is specced against the sprint branch. The deployed line is deliberately left alone, because its
invariant cannot even be evaluated there: `ClientInvite.requestId` exists in the schema but **no deployed
code ever populates it**, so a lead cannot be joined to its own invite at all. The deployed line's work is
detection (T-977) and its specific holes (T-973, T-974).

When the sprint branch eventually deploys, every historical invite gets `requestId = NULL`, so every
lead activated before the migration reads as stranded on day one. I1 cannot be applied retroactively.
The cutoff is a hard requirement on T-977, not an afterthought.

## If you are about to change something here

Ask the three questions that would have caught both incidents:

- Can this leave a lead ACTIVE with neither a roster row nor a redeemable invite?
- Does anything now claim a relationship without reading `CoachClient`?
- Does this add a seventh way to write `consultationStage`?
