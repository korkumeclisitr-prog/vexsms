import { createBrowserClient } from "@supabase/ssr";
import { Database } from "@/lib/supabase/types";

export function createClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://zdblltfiqfttktkepubr.supabase.co";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "sb_publishable_s8L40TFgladKkyiOu1gOXQ_yWX0-2l9";

  return createBrowserClient<Database>(url, anonKey);
}
