// Main-process copy of src/lib/config.ts's constants — main.js is plain
// CommonJS and can't import the renderer's TypeScript module directly. Keep
// these two files in sync if either changes.
const SUPABASE_URL = "https://tdaurfsglbxoutvdybjm.supabase.co";
const API_BASE = "https://minuteflow.click";

module.exports = { SUPABASE_URL, API_BASE };
