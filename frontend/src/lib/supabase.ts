import { createClient } from "@supabase/supabase-js";

// Dienstplan Supabase project (separate from Hotel PMS). Values come from .env (see .env.example).
export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
);
