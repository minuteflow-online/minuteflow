// These are the same NEXT_PUBLIC_* values the web app ships to the browser
// and the Chrome extension already hardcodes (extension/supabase.js) — not
// secrets. The service-role key stays server-side only and never belongs here.
export const SUPABASE_URL = "https://tdaurfsglbxoutvdybjm.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkYXVyZnNnbGJ4b3V0dmR5YmptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDUyMTQsImV4cCI6MjA4OTUyMTIxNH0.88v232bVlqCb1UjL6XJ3rFrPA7-qA0yVrxOJXLh0eZw";

export const API_BASE = "https://minuteflow.click";
