create index if not exists idx_tx_org_import_batch
on public.transactions (organization_id, import_batch_id)
where import_batch_id is not null;
