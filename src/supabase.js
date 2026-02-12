import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://oaqtvkrfaozaqlamjxcr.supabase.co";
const SUPABASE_KEY = "sb_publishable_2iiv6FznBAFSQ_rgng_V6g_JS4n1voC";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
