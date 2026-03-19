-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the cannibal_audits table for saving audit results

CREATE TABLE IF NOT EXISTS cannibal_audits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer DEFAULT 0,
  site text,
  active_event text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS but allow public read/write (matches prospect-qualifier pattern)
ALTER TABLE cannibal_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON cannibal_audits FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON cannibal_audits FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete" ON cannibal_audits FOR DELETE USING (true);
