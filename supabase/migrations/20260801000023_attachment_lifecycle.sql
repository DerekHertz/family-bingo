-- Slice 16, server half — Photos: the path, and what happens when it is deleted.
--
-- Acceptance test (PRD §16):
--   Given a Member logging an Increment
--   When they attach a photo
--   Then it uploads to Supabase Storage, appears in the Family Feed, and is
--   UNREADABLE by any Account outside the Family — including by direct URL
--
-- The bucket, the path shape and the three Storage policies landed in
-- 20260801000006_storage.sql, and storage_attachments.test.sql already proves the
-- object-level boundary. That file also says plainly what it does not prove: the HTTP
-- half, against a real object URL. §16.5 calls that "the single highest-consequence test
-- in the suite", so it is written in this slice as an integration test
-- (supabase/tests/integration/storage_urls.test.ts) rather than left as a comment.
--
-- What is left for the database is the two ends of an Attachment's life: that its path
-- can only ever name its own Increment, and that deleting it removes the object.

-- ---------------------------------------------------------------------------------
-- §16.2 — the path is derived, not chosen
-- ---------------------------------------------------------------------------------
--
-- `storage_path` was free text. `attachments_own_insert` checks that the Increment
-- belongs to a Member you control, but nothing checked what the row POINTED AT — so a
-- Member could hang a row off their own Increment carrying another Family's object path.
--
-- Storage RLS still refused them the bytes, so this was never a way to see a photo. It
-- was a way to get another Family's object path to render inside their own Feed, where
-- attachment_path is handed to the client to sign; a boundary that holds only because
-- the second lock held is not a boundary worth relying on (ADR-0004).
--
-- The path is a function of the Increment, so it is checked as one. `{family_id}/
-- {increment_id}`, with an optional extension, matching the layout the bucket was
-- created with.
create or replace function enforce_attachment_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_family uuid;
  expected      text;
begin
  select m.family_id into owning_family
    from increments i
    join members m on m.id = i.member_id
   where i.id = new.increment_id;

  if owning_family is null then
    raise exception 'no such Increment' using errcode = '42501';
  end if;

  expected := owning_family::text || '/' || new.increment_id::text;

  -- The extension is the client's business — it downscales and re-encodes (§16.4) — but
  -- everything before it is not.
  if new.storage_path <> expected and new.storage_path not like expected || '.%' then
    raise exception 'an Attachment path must name its own Increment, inside its own Family'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger attachments_enforce_path
  before insert or update on attachments
  for each row execute function enforce_attachment_path();

-- ---------------------------------------------------------------------------------
-- §16.6 — deleting an Increment deletes the photo, not just the row
-- ---------------------------------------------------------------------------------
--
-- "Orphaned images of children sitting in a bucket after a user believes they deleted
-- them is the worst version of this feature" (ADR-0005, and the comment already in
-- 20260801000006_storage.sql). The `attachments` row cascades when its Increment goes;
-- the object does not follow, and the database cannot make it.
--
-- **Postgres refuses.** `storage.protect_delete()` is a BEFORE DELETE FOR EACH STATEMENT
-- trigger that Supabase installs on `storage.objects`, and it raises for everyone,
-- superuser included: "Direct deletion from storage tables is not allowed. Use the
-- Storage API instead." Deleting the row is not an option this slice gets to choose. It
-- also means `attachments_family_delete`, the third policy in the storage migration,
-- only ever governs deletes arriving through that API.
--
-- So the same shape as the push outbox (§15): record the intent transactionally, and let
-- something that can speak HTTP carry it out. The row going away and the reaping being
-- owed are one commit; the bytes disappearing is the reaper's job, moments later.
--
-- The gap between them is small and bounded, and nothing hands the path out during it:
-- `attachments` is where the Feed reads `attachment_path` from, and that row is already
-- gone. A signed URL minted before the delete outlives it — signed URLs are stateless —
-- which is exactly why the TTL is short (§16.2).
create table orphaned_objects (
  id           uuid primary key default gen_random_uuid(),
  bucket_id    text not null,
  object_path  text not null,
  -- Kept for the reaper's logs and for answering "what was deleted for this Family",
  -- after the Attachment it came from no longer exists to be joined to.
  family_id    uuid,
  orphaned_at  timestamptz not null default now(),
  reaped_at    timestamptz,
  attempts     int not null default 0
);

comment on table orphaned_objects is
  'PRD §16.6. Storage objects whose Attachment has been deleted and whose bytes are '
  'therefore owed a removal. Postgres cannot delete them — storage.protect_delete() '
  'refuses everyone — so the reap-attachments Edge Function drains this through the '
  'Storage API.';

create index orphaned_objects_pending_idx on orphaned_objects (orphaned_at)
  where reaped_at is null;

alter table orphaned_objects enable row level security;
-- No policy and no grant. This is a work queue for the service role; a client has no
-- business reading a list of recently deleted photo paths.

create or replace function orphan_attachment_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_family uuid;
begin
  -- The Increment is usually already gone by now — this fires on the cascade — so the
  -- Family is read off the path, which enforce_attachment_path() guarantees begins with
  -- it. That guarantee is why this can be a single split rather than a join.
  owning_family := safe_uuid(split_part(old.storage_path, '/', 1));

  insert into orphaned_objects (bucket_id, object_path, family_id)
  values ('attachments', old.storage_path, owning_family);

  return null;
end;
$$;

create trigger attachments_orphan_object
  after delete on attachments
  for each row execute function orphan_attachment_object();

revoke execute on function enforce_attachment_path() from public, anon, authenticated;
revoke execute on function orphan_attachment_object() from public, anon, authenticated;
