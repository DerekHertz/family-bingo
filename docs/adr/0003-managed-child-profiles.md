# Children participate as Managed Members, with no login of their own

Children are the best participants in a family bingo and the entire compliance surface of
the app. A nine-year-old has no email address, cannot complete a verification flow, and —
once the app is publicly listed — cannot have personal data collected without verifiable
parental consent. So children get no Account at all: a Guardian creates a **Managed
Member** under their own login, and the child gets a name, an avatar, a Board and Goals,
but never an email, a password, or a session.

This is the Netflix-profile / Apple Family Sharing pattern, and it does four jobs at once:
consent is *inherent* rather than bolted on (the Guardian created the profile), the
signup UX problem disappears, uploaded photos have an accountable adult attached, and
account deletion has an obvious actor.

## Considered options

**Everyone gets an account, 13+ only.** Simplest compliance posture and the simplest
schema — Account and Member stay effectively 1:1. Rejected because it excludes the most
enthusiastic participants, and because families will lie about ages rather than leave a
child out, which is worse than modelling it honestly.

**Real child accounts behind a full COPPA consent flow.** Most respectful of a child's
autonomy — their own login on their own device. Rejected as far more to build, with a
consent flow that is a hard barrier at exactly the moment a family is trying to get set
up together.

**Ignore age entirely.** Fine for the private phase, incompatible with the decision to
design for a public listing. Retrofitting consent — and possibly deleting already-
collected minor data — at launch time is the expensive version of this.

## Consequences

- **`Account → Member` becomes one-to-many.** This is the single most invasive consequence: "the logged-in user" is no longer "the player." The UI needs a profile switcher and every write path needs to know which Member it is acting as.
- `members` carries both `account_id` and `guardian_account_id`, with a `CHECK` enforcing that exactly one is set.
- Actions taken by a Guardian on behalf of a child are attributed **to the child** in the Feed. The Guardian is the actor, the Managed Member is the subject.
- The same mechanism covers a grandparent who cannot manage an app, for free.
- Converting a Managed Member into a real Account is deliberately **out of scope**. It is a genuine migration (identity, consent, ownership of past content) and guessing at it now would be worse than leaving it unbuilt.
- This is a design aimed at making a lawyer's review short. It is not a substitute for one before any public listing.
