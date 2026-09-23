const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await supa.from("whatsapp_bot_leads").select("*").limit(1);
  if (error) {
    console.error("error:", error.message);
  } else {
    console.log("data:", data);
  }
}
test();
