-- Permite que los miembros borren filas de staging al eliminar lotes (CASCADE / reset).
create policy "members_delete_import_rows" on public.import_rows
for delete using (
  exists(
    select 1
    from public.import_batches b
    where b.id = import_rows.batch_id
      and public.is_org_member(b.organization_id)
  )
);
