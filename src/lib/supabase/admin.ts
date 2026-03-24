import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const createAdminClient = () => {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};
