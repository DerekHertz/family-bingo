# Cumulative targets only — pace is advisory and never enforced

Goals are counters: a `target` and a running count of Increments. "Walk 12 times a month"
is stored as **"144 walks this year, about 12 a month"**, where the cadence is a display
string and the target is the whole year. There is no per-period enforcement, no streak,
and no mechanism by which missing a month can make a Tile unachievable.

A one-shot goal is simply `target = 1`. There is no goal-type enum and no second code
path.

## Why not enforce the cadence

Because of what it does on March 31st. Under strict per-period rules, someone who gets
the flu and walks 4 times in March has **permanently failed that tile** — and then stares
at a dead square, and any line running through it, for the remaining nine months. That is
the failure mode that empties a year-long app. Under a cumulative target the same flu is
a deficit they can make up in October.

The phrasing users want ("12 times a month") is preserved in `pace_hint`; it just isn't
the enforcement mechanism.

## Consequences

- `pace_hint` is **display only**. Nothing in the codebase may branch on it — the moment any completion, progress, or eligibility check reads it, this decision has been quietly reversed.
- One column (`target`) and one code path covers both goal shapes. No `goal_type` enum, no per-period progress rows.
- A future reader will notice there are no streaks and may assume it was an oversight. It was not: streaks are the same failure mode wearing a friendlier name.
- Progress is `COUNT(increments)`, never a stored counter — a cached count and an append-only log will drift, and the log is the source of truth.
- Because Increments are append-only and idempotent on a client-generated UUID, the offline queue needs **no conflict resolution at all**. That property is a direct consequence of this decision.
