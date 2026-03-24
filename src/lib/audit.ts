import { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntry = {
  organization_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes_json?: Record<string, unknown>;
};

export const logAudit = async (client: SupabaseClient, entry: AuditEntry) => {
  await client.from("audit_log").insert({
    organization_id: entry.organization_id,
    actor_user_id: entry.actor_user_id,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    changes_json: entry.changes_json ?? {},
  });
};
