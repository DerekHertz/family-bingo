# Boards are personal, and owned by a Member rather than an Account

A family bingo could plausibly give everyone the same 25 squares and race them. We chose
instead to let each Member author their own 24 goals, because a shared board has to work
simultaneously for a nine-year-old and a grandparent — and goals that clear that bar are
usually too bland to be worth pursuing. The Family stays meaningful through the shared
Center Tile, the Feed, and the vote, rather than through identical squares.

A Board therefore hangs off a **Member**, not an Account. Someone in two Families keeps
two independent Boards.

## Considered options

**Shared board, per-member progress.** Same 25 tiles for everyone; a direct race.
Strongest communal pull and the simplest schema, but the authoring negotiation across a
wide age range is genuinely hard, and one unfair tile poisons everyone's board.

**One Board per Account, shared into every Family.** Less authoring, and arguably truer
to life — your goals are your goals regardless of audience. Rejected because two Families
voting different Center Tiles into one Board is unresolvable without an arbitrary
"primary family" tiebreak, and because progress and photos would then cross a Family
boundary between people who may not know each other.

**One Family per Account.** Smallest possible model. Rejected because it breaks
immediately for anyone with in-laws.

## Consequences

- **Ranking becomes meaningless and is therefore banned.** Self-authored boards mean a leaderboard measures who set the easiest goals. No winner, no leaderboard, no "first to bingo" (PRD §13.5). Bingo is a milestone on a ladder ending at Blackout.
- Two knock-on problems dissolve for free: **late joiners** need no proration (there is no standing to be behind in), and **fairness** stops being a design constraint anywhere.
- Sharpening runs ~24× per member per year rather than 24× per family — which is what promoted it from a nice-to-have to a core, high-traffic feature.
- Every query is Family-scoped by construction, which is the property [ADR-0004](0004-supabase-rls-boundary.md) leans on.
- The cost we accepted: playing seriously in two Families means 48 goals. We expect this to be self-regulating — people will play in one and lurk in the other — and preferred permitting it over forcing a compromise on whoever genuinely wants both.
