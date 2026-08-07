# Family Bingo

An annual goal-setting game. Each person fills a 5×5 board with personal goals for
the year and works to complete them, while their family watches, cheers, and gets
notified as squares fall.

This file is the glossary and nothing else — no requirements, no schema, no decisions.
Those live in [`docs/prd.md`](docs/prd.md), [`docs/schema.md`](docs/schema.md), and
[`docs/adr/`](docs/adr/). Code should use these names.

## Language

### The social side

**Family**:
A named group of people who can see each other's boards for a given year. The unit
of privacy — nothing is visible outside the Family that owns it.
_Avoid_: Group, team, household, circle

**Member**:
A person's participation in one Family. Someone in two Families is two Members, and
everything they own (Board, Goals, Increments) hangs off the Member, never the
Account. Nothing crosses a Family boundary. A Member is backed either by their own
Account or, if they are a child, by a Guardian's.
_Avoid_: User, player, participant, membership

**Guardian**:
The Account answerable for a Managed Member — it created the profile, it plays on that
person's behalf, and it is accountable for anything posted under them.
_Avoid_: Parent, owner, supervisor

**Managed Member**:
A Member with no login of their own, played through their Guardian's Account. How
children take part: they get a name, a Board and Goals, but never an email, a password
or an independent identity.
_Avoid_: Child account, sub-account, kid user, dependent

**Account**:
The login identity — one per real person. May be a Member of several Families.
_Avoid_: User, profile

**Organizer**:
The Member who administers a Family: invites people, opens each Year, and breaks tied
votes. A role, not a separate kind of person — an Organizer plays too.
_Avoid_: Admin, owner, host, parent

### Being watched

**Feed**:
The Family's running record of everything that has happened this Year — every
Increment, Milestone, Swap, vote outcome and Member arriving. Read when a Member opens
the app; it never interrupts anyone.
_Avoid_: Timeline, activity log, stream, wall

**Milestone**:
An event rare and meaningful enough to interrupt someone for: completing a Tile,
Bingo, Blackout. Only Milestones are pushed to phones; everything else waits in the
Feed.
_Avoid_: Achievement, event, notification

**Digest**:
An optional weekly summary of the Family's Feed, sent to Members who want a pull back
into the game without a stream of interruptions.
_Avoid_: Summary, roundup, newsletter

**Invitation**:
A single-use, expiring link the Organizer creates for one specific person. Following
it does not make someone a Member — it asks to become one, and the Organizer must
agree.
_Avoid_: Invite link, join code, referral

### Deciding together

**Setup Window**:
The stretch between a Year being opened and Boards Sealing, during which Members write
their Goals and the Center Vote runs. It ends on a fixed date whether or not everyone has
finished — or sooner, if every Member has said they are Ready. The date is a backstop
against nobody finishing, not a wait imposed on a Family who have.
_Avoid_: Draft period, onboarding, pre-season

**Ready**:
A Member's statement that their own Board is finished. Offered once all 24 authorable
squares hold a Goal, taken back freely until it is the last one, and never inferred from
a full Board — writing the last Goal and being done with it are different moments. When
every Member is Ready the Boards Seal.
_Avoid_: Submit, lock in, confirm, finalise

**Center Vote**:
The Family's decision on what kind of Center Tile this Year has — a shared Family Goal
or a personal square. Decided by the Ballots actually cast.
_Avoid_: Poll, election, mode vote

**Proposal**:
A candidate Family Goal put forward by a Member for the Family to vote on.
_Avoid_: Suggestion, nomination, candidate

**Ballot**:
One Member's vote, changeable until the Setup Window closes. Not casting one is an
abstention: silence never blocks an outcome, it only forfeits a say.
_Avoid_: Vote (the act), choice

### The game

**Board**:
One Member's 5×5 grid for one Year — owned by the Member, not the Account, so playing
in two Families means keeping two Boards. Every Member authors their own 24 outer
Tiles; all Boards in a Family may share a Center Tile.
_Avoid_: Card, grid, sheet

**Center Tile**:
The middle square of every Board, whose nature the Family votes on each Year. It is
either a Family Goal identical across all Boards, or a personal square each Member
fills alone.
_Avoid_: Free space, wildcard, middle square

**Family Goal**:
A single Goal the whole Family commits to together, chosen by vote and placed on every
Member's Center Tile. Completing it completes that Tile for everyone at once.
_Avoid_: Group goal, shared goal, team goal

**Tile**:
One of the 25 squares on a Board, holding a single Goal. Identified by its position,
which is fixed once the Board is sealed.
_Avoid_: Square, cell, box

**Goal**:
The thing a Member is trying to accomplish, written on a Tile. Goals are personal and
are sharpened for trackability before they land on the Board.
_Avoid_: Task, objective, resolution, challenge

**Year**:
The season of play. A Family runs one Board per Member per Year.
_Avoid_: Season, round, cycle

### The life of a Board

**Sealing**:
The moment a Board stops being a draft and becomes the Member's commitment for the
Year. Happens when the Setup Window ends — on its deadline, or as soon as every Member is
Ready. Everything before Sealing is free editing; everything after costs a Swap.

Sealing is not the start of the Year. A Family who finish in December Seal in December
and still begin on 1 January: progress cannot be recorded until the Year itself opens.
_Avoid_: Locking, publishing, submitting, finalising

**Freeze**:
What happens to a Year at the end of December. Progress can no longer be recorded or
backdated, and the Boards become permanent family history.
_Avoid_: Close, archive, lock, end

**Wrapped**:
The story of a finished Year, revealed to the whole Family the moment it Freezes — what
everyone completed, what the numbers added up to, and the Awards. Deliberately timed to
sit between one Year ending and the next being written.
_Avoid_: Recap, summary, report, year in review

**Award**:
A superlative handed to a Member in Wrapped — most consistent, biggest month, best
comeback. There are always at least as many Awards as there are Members, and they
measure unrelated things, so that receiving one never means placing above anyone.
_Avoid_: Prize, trophy, rank, badge, achievement

**Swap**:
A Member's one permitted change to a Sealed Board — replacing a Goal or lowering its
Target. Each Member gets three per Year, and every one is shown to the Family.
Raising a Target is not a Swap, because making a Goal harder needs no policing.
_Avoid_: Edit, change, substitution

**Revision**:
The permanent record of a Swap: what the Tile said before, what it says now, and when.
Never deleted — it is what makes a Bingo checkable rather than merely claimed.
_Avoid_: History, audit, changelog

### Tracking a Goal

**Target**:
How many times a Goal must be done before its Tile is complete. A Target of 1 means
the Goal is one-and-done; anything higher means it accumulates over the Year.
_Avoid_: Quota, requirement, threshold

**Progress**:
How far a Member has got toward a Goal's Target. Only ever counts up.
_Avoid_: Score, count, tally

**Increment**:
A single recorded instance of doing a Goal — one walk, one book. The unit Progress
is made of. Logging one is always a single tap; a Member may add a note or a photo,
but never has to.
_Avoid_: Check-in, log entry, tick

**Attachment**:
A photo a Member optionally hangs on an Increment. Visible only to their Family, and
never outside it.
_Avoid_: Media, upload, image, evidence, proof

**Sharpening**:
Turning a Member's freeform wish into a Goal with a Target and a Unit — "walk every
day" into "144 walks, about 12 a month". The app proposes; the Member decides. A wish
that resists Sharpening is still allowed onto the Board as a one-shot Goal, because
refusing someone's goal is worse than failing to measure it.
_Avoid_: Validation, refinement, SMART-ifying

**Unit**:
What a Goal's Increments are counted in — walks, books, dollars, days. Carries a
canonical form alongside the Member's own wording, so that one person's "Books" and
another's "book" can be added together at the end of the Year.
_Avoid_: Measure, metric

**Category**:
The kind of life a Goal belongs to — fitness, family, learning, money, health,
creative. Inferred during Sharpening rather than chosen, so that nobody has to file
their ambitions before pursuing them.
_Avoid_: Tag, label, type, area

**Pace**:
The rhythm a Goal is meant to be done at ("about 12 a month"), shown to a Member so
they can see whether they are behind. Advisory only: falling behind Pace never makes
a Tile unachievable, it only creates a deficit to make up.
_Avoid_: Schedule, cadence, frequency, streak

**Line**:
Any of the twelve straight runs of five Tiles on a Board — five rows, five columns,
two diagonals.
_Avoid_: Row, streak, sequence

**Bingo**:
A Member completing their first Line. A milestone rather than an ending: play runs to
the end of the Year regardless, and Members are never ranked against each other,
because Boards are self-authored and ranking them would only measure who set the
easiest Goals.
_Avoid_: Win, victory

**Blackout**:
Completing all 25 Tiles on a Board. The highest achievement of the Year.
_Avoid_: Full house, perfect board, clean sweep
