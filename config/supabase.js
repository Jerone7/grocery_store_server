const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase URL or Key is missing. Image upload features will be unavailable.");
  console.log("URL:", supabaseUrl);
  console.log("Key:", supabaseKey ? "Set" : "Not Set");
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

const getSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY to enable uploads.");
  }

  return supabase;
};

module.exports = {
  supabase,
  getSupabase,
};
