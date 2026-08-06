## What this changes

<!-- One or two sentences. The commit message carries the *why*; this is the summary. -->

## Why

<!-- The reasoning, and the trap it closes if it closes one. If this fixes a bug, say what
     the wrong behaviour actually was and how you reproduced it — this repo's history is
     the main documentation of what has already gone wrong. -->

## Checks

- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] `npm run db:test` — only if `supabase/**` changed. Needs `npx supabase db reset` first
- [ ] `npm run test:integration` — only if the wire contract changed
- [ ] Looked at it running, if it changes anything a person sees

## Spec

<!-- Which PRD slice or FRONTEND_DESIGN section this implements or affects. If it departs
     from one, say so here rather than in a comment nobody will find — the two documents
     already disagree in six places, all recorded in docs/HANDOFF.md. -->
