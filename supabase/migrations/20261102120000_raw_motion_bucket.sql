-- Private bucket for the owner's raw 60 Hz motion chunks (services/sensors/rawCapture.js).
-- Upload is limited to that one account's own folder; nobody else can read or write.
-- The operator endpoint reads with the service key, which bypasses these policies.
insert into storage.buckets (id, name, public, file_size_limit)
values ('raw-motion', 'raw-motion', false, 1048576)
on conflict (id) do nothing;

drop policy if exists "raw motion: owner uploads" on storage.objects;
create policy "raw motion: owner uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'raw-motion'
    and auth.uid() = '6df5b1f1-a5c6-49fa-9b93-fc837c267af9'::uuid
    and (storage.foldername(name))[1] = auth.uid()::text
  );
