-- Progress for a whole Board in one small answer.
--
-- `COUNT(increments)` is the source of truth for progress and is never denormalized
-- (PRD §11.4) — that is not changed here and must not be. This aggregates on **read**,
-- which is the same count asked in a better place: there is still no stored counter to
-- drift, and deleting an Increment still moves the number on the next read.
--
-- What it replaces is a client that fetched every Increment row on the Board and counted
-- them in JavaScript, and two problems came with that:
--
--   * **It could not start until the Tiles had arrived.** The counts were keyed on the 25
--     Tile ids, so opening a Board was two serial round trips — Tiles, then Increments —
--     and every one of them crosses a continent. It was invisible on the one Board a
--     Member opens daily and obvious the moment §23 let them open four more.
--   * **It paged, and PostgREST truncates at `max_rows = 1000` in silence.** The old
--     comment worried about this at length and was right to: `goals.target` has no upper
--     bound, so a busy Board in aggregate quietly lost Increments and a complete Tile
--     rendered as `sprouting` with its Line missing. The loop that handled it made a
--     *third* round trip on exactly the Boards that could least afford one.
--
-- Twenty-five rows at most, one response, no paging, and the truncation hazard stops
-- existing rather than being handled. On a Board with 339 Increments it is 1.1 KB against
-- 18.3 KB; the gap widens all year.
--
-- **SECURITY INVOKER, which is the default and is the whole point.** api.md §2 claims
-- reads run as the caller so RLS still applies, and most of the write RPCs in this schema
-- are the documented exception to that. This one is not: `increments_family_read` and
-- `tiles_read` decide every row, exactly as they did when the client sent the query
-- itself. A Member of another Family gets nothing, and gets it as zero rows rather than
-- an error (§8.1's P2, and api.md §9's rule that a denial is empty rather than a 403).
create or replace function board_tile_counts(target_board_id uuid)
returns table (tile_id uuid, n int)
language sql
stable
set search_path = public
as $$
  select i.tile_id, count(*)::int
    from increments i
    join tiles t on t.id = i.tile_id
   where t.board_id = target_board_id
   group by i.tile_id
$$;

comment on function board_tile_counts(uuid) is
  'PRD §11.4 — progress for every Tile on one Board, counted at read time. Returns only '
  'Tiles that have at least one Increment; a Tile absent from the result has none. '
  'SECURITY INVOKER: RLS decides the rows, so a caller outside the Family gets none.';

revoke execute on function board_tile_counts(uuid) from public, anon;
grant execute on function board_tile_counts(uuid) to authenticated;
