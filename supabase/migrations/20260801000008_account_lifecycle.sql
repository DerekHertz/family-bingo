-- Slice 1, server half — an Account comes into existence, and can be destroyed.
--
-- PRD §1.2 is the rule this file exists to honour: an Account is identified by
-- `accounts.id`, which IS `auth.users.id`, and never by email. Apple private-relay
-- addresses change and are not unique per person, so email is display and contact only.
-- Nothing here joins on it.

-- Every authenticated identity gets exactly one Account row, created the moment Supabase
-- Auth writes the user. Doing this in a trigger rather than a first-launch client call
-- means there is no window in which a signed-in caller has no Account to hang a Member
-- off, and no way for a client to forget.
create or replace function handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into accounts (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_account();

-- Keep the contact address current. Apple relay addresses rotate, and the row should
-- follow rather than accumulate stale copies — but note that this is the ONLY thing
-- email is for. It is never an identity key (§1.2).
create or replace function handle_account_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update accounts set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function handle_account_email_change();

-- A Goal belongs to exactly one Tile and has no other owner, so it has to leave when the
-- Tile does. Without this, deleting an Account would strand its Goal rows: `tiles.goal_id`
-- is ON DELETE SET NULL (a Goal outliving a Swap is the point — see PRD §18.6), which
-- means the cascade runs the wrong way for deletion.
--
-- §1.5 lists Goals among the things an Account deletion must take with it, and an
-- App Store account-deletion promise that quietly leaves rows behind is not one.
create or replace function delete_orphaned_goal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.goal_id is not null then
    delete from goals g
     where g.id = old.goal_id
       and not exists (select 1 from tiles t where t.goal_id = g.id);
  end if;
  return old;
end;
$$;

create trigger tiles_delete_orphaned_goal
  after delete on tiles
  for each row execute function delete_orphaned_goal();

-- Account deletion, required from day one (PRD §1.5 — an App Store requirement, and the
-- product is meant to be publicly listed eventually).
--
-- Deleting the auth.users row is enough to remove everything: accounts cascades from it,
-- members cascades from accounts by BOTH account_id and guardian_account_id, and Boards,
-- Tiles, Increments, Attachments, Milestones, Revisions, Ballots and Proposals all
-- cascade from members. The trigger above sweeps the Goals.
--
-- SECURITY DEFINER because auth.users is not the caller's to touch. The function still
-- only ever deletes auth.uid(), so it cannot be pointed at anyone else.
--
-- KNOWN SPEC CONFLICT, resolved in favour of the PRD. §1.5 says deletion takes "every
-- Managed Member it guards" with it. FRONTEND_DESIGN §4.6 instead says "Managed Members
-- transfer". Transfer is the kinder behaviour and §4.7 calls handover "the exit everybody
-- eventually takes", but no transfer flow is specified, ADR-0003 puts converting a
-- Managed Member out of scope, and inventing one here would mean guessing who inherits a
-- child's Board. This implements §1.5 literally: a Guardian deleting their Account
-- deletes their children's Boards too. If that is wrong, it is a product decision and
-- should be made before any public listing, not in this function.
create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  delete from auth.users where id = caller;
end;
$$;

revoke execute on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;

-- The account-provisioning triggers run as the definer and are never called directly.
revoke execute on function handle_new_account() from public, anon, authenticated;
revoke execute on function handle_account_email_change() from public, anon, authenticated;
revoke execute on function delete_orphaned_goal() from public, anon, authenticated;
