#!/usr/bin/env bash
#
# Migrations that would break the client that is already deployed.
#
# `deploy.yml` refuses to ship a bundle whose migrations have not reached production, so
# the client can never overtake the schema. This is the other direction, which that gate
# cannot see: a migration that is perfectly safe to apply and breaks the site the moment
# it lands, because the currently-deployed bundle still selects the column it removes.
# Pushing the schema first is the right order only while migrations add.
#
# The answer is expand-contract — add the new shape, ship the client that uses it, remove
# the old shape in a LATER migration — and no check can infer that intent from SQL. So
# this forbids nothing. It requires the decision to be written down in the migration,
# where the next reader meets it, rather than made silently.
#
# A script rather than an inline `run:` block, unlike this repo's other guards, because
# those are five-line file-existence checks and this is pattern matching with an escape
# hatch. It has tests: scripts/check-migrations-additive.test.sh.
#
# Usage:  BASE=<sha> HEAD=<sha> scripts/check-migrations-additive.sh
#         MIGRATIONS="a.sql b.sql" scripts/check-migrations-additive.sh   # explicit list
set -euo pipefail

MIGRATION_GLOB=${MIGRATION_GLOB:-'supabase/migrations/*.sql'}

if [ -n "${MIGRATIONS:-}" ]; then
  touched="$MIGRATIONS"
else
  zero=0000000000000000000000000000000000000000
  base="${BASE:-}"
  head="${HEAD:-HEAD}"
  if [ -z "$base" ] || [ "$base" = "$zero" ]; then
    base="$(git rev-parse "${head}^" 2>/dev/null || true)"
  fi
  if [ -z "$base" ]; then
    # A branch with no parent in the clone. The deploy gate is the backstop that matters,
    # and refusing to run here would fail closed on a condition that says nothing about
    # the migrations themselves.
    echo "No base commit to diff against — no new migrations to read."
    exit 0
  fi
  touched="$(git diff --diff-filter=AM --name-only "$base" "$head" -- "$MIGRATION_GLOB" || true)"
fi

if [ -z "${touched// /}" ]; then
  echo "No migrations added or changed."
  exit 0
fi

# Comments are stripped before matching. Half these migrations discuss dropping a column
# in prose — 20260801000034 spends a paragraph on why it does *not* shuffle
# `tiles.position` — and a guard that fires on its own documentation is a guard people
# delete rather than read.
#
# `drop function` is deliberately not in this list and is handled separately below. The
# established idiom here is to drop and immediately recreate in the same file, because
# CREATE OR REPLACE cannot change an argument list (20260801000033 explains it at length).
# A function that comes back is a replacement, not a removal.
destructive='drop[[:space:]]+(table|column|view|policy|index)'
destructive="${destructive}|rename[[:space:]]+(column[[:space:]]+)?[a-z_\"]+[[:space:]]+to"
destructive="${destructive}|alter[[:space:]]+column[[:space:]]+[a-z_\"]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type"

failed=0
for file in $touched; do
  [ -f "$file" ] || continue
  body="$(sed 's/--.*$//' "$file")"

  hits="$(printf '%s\n' "$body" | grep -inE "$destructive" || true)"

  # A dropped function that nothing in the same file creates again under the same name.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name="$(printf '%s\n' "$line" |
      sed -nE 's/.*[Dd][Rr][Oo][Pp][[:space:]]+[Ff][Uu][Nn][Cc][Tt][Ii][Oo][Nn][[:space:]]+([Ii][Ff][[:space:]]+[Ee][Xx][Ii][Ss][Tt][Ss][[:space:]]+)?([a-zA-Z0-9_]+).*/\2/p')"
    [ -n "$name" ] || continue
    if ! printf '%s\n' "$body" |
        grep -qiE "create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+${name}[[:space:]]*\("; then
      hits="${hits}
drop function ${name} — and nothing in this file recreates it"
    fi
  done <<< "$(printf '%s\n' "$body" | grep -inE 'drop[[:space:]]+function' || true)"

  hits="$(printf '%s\n' "$hits" | sed '/^[[:space:]]*$/d')"
  [ -n "$hits" ] || continue

  # The escape hatch, and it lives in the migration on purpose. A marker in the workflow, a
  # label on the pull request or a commit trailer would each be read once and never again;
  # this one is in front of whoever opens the file in two years asking where the column
  # went.
  if grep -qE '^--[[:space:]]*expand-contract:[[:space:]]*[^[:space:]]' "$file"; then
    echo "  $file: destructive, and says why —"
    grep -E '^--[[:space:]]*expand-contract:' "$file" | sed 's/^/    /'
    continue
  fi

  failed=1
  echo "::error file=${file}::${file} changes a shape the deployed client may still be using, with no expand-contract note."
  printf '%s\n' "$hits" | sed 's/^/    /'
done

if [ "$failed" -ne 0 ]; then
  cat <<'WHY'

A migration that removes or retypes something is applied to production BEFORE the client
that stops using it is deployed — that is the order deploy.yml enforces, and it is the
safe one only while migrations add. Removing a column the live bundle still selects breaks
the site at the moment of the push, not at the deploy.

Either split it — add the new shape now, remove the old one in a later migration, once the
client that used it is no longer deployed — or record the decision in the migration and
this will pass:

  -- expand-contract: <why this is safe to apply under the deployed client>

WHY
  exit 1
fi

echo "No unexplained destructive changes."
