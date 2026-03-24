const requirePublic = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`Falta variable de entorno: ${name}`);
  }
  return value;
};

export const env = {
  supabaseUrl: requirePublic(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  ),
  supabaseAnonKey: requirePublic(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
