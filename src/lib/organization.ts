import { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const getUserOrganization = async (
  client: SupabaseClient,
  userId: string,
) => {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return data;
  }

  // Fallback para evitar bloqueo por RLS durante bootstrap inicial.
  const admin = createAdminClient();
  const { data: adminData, error: adminError } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (adminError || !adminData) {
    return null;
  }

  return adminData;
};
