-- Attachment storage — the highest-consequence boundary in the app.
--
-- One optional photo per Increment (PRD §16.1). The bucket is PRIVATE, the Family id is
-- the first path segment, and clients only ever receive short-TTL signed URLs. No public
-- bucket and no guessable path, ever — not even temporarily during development
-- (ADR-0005).
--
--   attachments/{family_id}/{increment_id}.jpg
--
-- The negative test for this file is the single highest-consequence test in the suite:
-- a direct object URL must fail both unauthenticated AND cross-Family (PRD §16.5).

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

-- A path segment that is not a uuid must return NULL rather than raise: a policy that
-- throws on a malformed object name is a policy an attacker can turn into an error
-- oracle, and errors abort the whole statement.
create or replace function safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

-- Storage RLS mirrors the Family boundary exactly (PRD §16.3, schema.md §4.3).
create policy attachments_family_read on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and safe_uuid((storage.foldername(name))[1]) in (select visible_family_ids())
  );

create policy attachments_family_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and safe_uuid((storage.foldername(name))[1]) in (select visible_family_ids())
  );

-- Deleting an Increment must delete the OBJECT, not just the row (PRD §16.6). Orphaned
-- images of children sitting in a bucket after a user believes they deleted them is the
-- worst version of this feature (ADR-0005).
create policy attachments_family_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and safe_uuid((storage.foldername(name))[1]) in (select visible_family_ids())
  );
