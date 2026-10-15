-- Run this in the Supabase SQL Editor to enable collaborative editing

CREATE TABLE IF NOT EXISTS collab_links (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE collab_links ENABLE ROW LEVEL SECURITY;

-- Owners can manage their collab links
CREATE POLICY "Owner manages collab_links" ON collab_links
  FOR ALL
  USING  (document_id IN (SELECT id FROM documents WHERE user_id = auth.uid()))
  WITH CHECK (document_id IN (SELECT id FROM documents WHERE user_id = auth.uid()));

-- Anyone can read collab links (token validation for collab page load)
CREATE POLICY "Public read collab_links" ON collab_links
  FOR SELECT
  USING (true);
