#!/usr/bin/env bash
#
# Tests for check-migrations-additive.sh, over fixtures rather than over git history, so a
# case can be written in three lines. Run it by hand: scripts/check-migrations-additive.test.sh
#
# The two that matter are the last two. A guard that fires on a migration's own prose gets
# deleted, and a guard that misses a real `drop column` is worse than not having one.
set -uo pipefail
cd "$(dirname "$0")/.."
guard="$PWD/scripts/check-migrations-additive.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass=0; fail=0
check() { # name, expected exit, file body
  local name="$1" want="$2" body="$3"
  local f="$work/$(echo "$name" | tr -c 'a-zA-Z0-9' '_').sql"
  printf '%s\n' "$body" > "$f"
  MIGRATIONS="$f" bash "$guard" >"$work/out" 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %s\n' "$name"
  else
    fail=$((fail + 1)); printf '  FAIL %s (exit %s, wanted %s)\n' "$name" "$got" "$want"
    sed 's/^/       /' "$work/out"
  fi
}

echo "check-migrations-additive"

check "an additive migration passes" 0 \
  "alter table boards add column ready_at timestamptz;
create index boards_ready_idx on boards (ready_at);"

check "drop column is refused" 1 \
  "alter table boards drop column ready_at;"

check "drop table is refused" 1 "drop table increments;"
check "drop view is refused" 1 "drop view feed;"
check "drop policy is refused" 1 "drop policy if exists notifications_self_read on notifications;"
check "renaming a column is refused" 1 "alter table boards rename column ready_at to done_at;"
check "retyping a column is refused" 1 "alter table goals alter column target type bigint;"

check "an expand-contract note is the way through" 0 \
  "-- expand-contract: nothing has selected legacy_flag since the July deploy.
alter table boards drop column legacy_flag;"

check "an empty note is not a note" 1 \
  "-- expand-contract:
alter table boards drop column legacy_flag;"

# The repo's own idiom: CREATE OR REPLACE cannot change an argument list, so a signature
# change is a drop followed by a create in the same file (20260801000033).
check "drop-then-recreate of a function passes" 0 \
  "drop function if exists write_goal(uuid, text, int);
create or replace function write_goal(tile_id uuid, goal_text text, target int, extra boolean default false)
returns void language sql as \$\$ select \$\$;"

check "dropping a function and not bringing it back is refused" 1 \
  "drop function if exists write_goal(uuid, text, int);"

# The one that decides whether anybody keeps this check.
check "prose about dropping a column is not dropping a column" 0 \
  "-- Shuffling tiles.position cannot be done here: we would have to drop column position
-- and drop table tiles, then rename column p to position, which collides with the
-- one_tile_per_position constraint at every intermediate row.
update tiles set goal_id = null where board_id = '00000000-0000-4000-8000-000000000000';"

check "a trailing comment does not hide a real drop" 1 \
  "alter table boards drop column ready_at; -- see the note above about position"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
