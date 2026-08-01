# Wrapped may hand out Awards, on unrelated axes and never as a ladder

[ADR-0001](0001-personal-boards.md) banned ranking outright, and PRD §13.5 says so
plainly. Wrapped is a deliberate, bounded exception: at year end it names individual
Members for superlatives — most consistent, biggest month, best comeback, first bingo.

The distinction that makes this coherent is **when**, not **what**. A live leaderboard
shapes behavior for twelve months: if the ladder is visible in February, the rational
move is to write easier goals next January. A retrospective superlative, revealed once
after everything is already decided, only describes what happened. Spotify Wrapped is
not a competition.

## The constraints that keep it from becoming a ranking

These are not stylistic. Remove any one of them and this decision has been reversed:

- **Awards sit on unrelated axes.** Most Increments, Most Consistent, Longest-Running Goal, Best Comeback, Most Photos, Quietest Achiever. Because the axes are orthogonal, someone who set 24 trivial goals cannot sweep them.
- **Every Member receives at least one.** If the natural winners leave someone out, assign from the unclaimed axes. A family of six where one person gets nothing is the failure this rule exists to prevent.
- **There is never a single ordered list.** No "most tiles completed, 1 through N." An Award names one person on one axis; it never implies a standing.

## Why the timing makes this higher-stakes than it looks

Wrapped lands days before goal-setting for the next Year. **Whatever it celebrates is
what the Family will optimize for in January.** An app that crowns "Most Tiles
Completed" has, in one screen, taught everyone to write easier goals — and quietly
undone the reason [ADR-0001](0001-personal-boards.md) banned ranking in the first place.

That feedback loop, not fairness, is the real argument. The awards aren't forbidden
because someone might feel bad; they're shaped this way because Wrapped is an
instruction for next year whether or not it intends to be.

## Consequences

- PRD §13.5a carves out the exception explicitly, so a future reader hitting an Award in the code doesn't "fix" it as a violation — or, worse, generalizes it into a leaderboard.
- The "everyone gets one" rule needs a real test, not an assertion. A family of six with one low-activity Member is the case that breaks a naive implementation.
- Aggregate Wrapped cards depend on `goals.unit_canonical` and `goals.category`, inferred during Sharpening (PRD §7.10). That is why two Wrapped-only fields appear in a Phase 1 slice: free-text units cannot be grouped retroactively once a year of them is written.
- Wrapped absorbed the separate "Recap" from the original Slice 20 — they were the same queries and the same UI wearing two names.
- Sharing is limited to a Member's own stats-only card (PRD §20.9), because a one-tap export of a family card would publish children's names and photos — which is what [ADR-0005](0005-photo-attachments.md) accepted the risk of *storing*, not of *broadcasting*.
