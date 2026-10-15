-- =============================================
-- PDF Annotator - Supabase Schema
-- Supabase ダッシュボード → SQL Editor でこれを実行してください
-- =============================================

-- 1. documents テーブル
create table public.documents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  pdf_path text not null,
  total_pages integer default 1,
  created_at timestamptz default now()
);

-- 2. annotations テーブル
create table public.annotations (
  id uuid default gen_random_uuid() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  page_number integer not null,
  strokes jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  unique(document_id, page_number)
);

-- 3. share_links テーブル
create table public.share_links (
  id uuid default gen_random_uuid() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz default now()
);

-- =============================================
-- Row Level Security (RLS)
-- =============================================

-- documents
alter table public.documents enable row level security;

create policy "Users can manage own documents"
  on public.documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Anyone can read shared documents"
  on public.documents for select
  using (
    exists (select 1 from public.share_links sl where sl.document_id = id)
  );

-- annotations
alter table public.annotations enable row level security;

create policy "Users can manage annotations for own documents"
  on public.annotations for all
  using (
    exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  );

create policy "Anyone can read shared annotations"
  on public.annotations for select
  using (
    exists (select 1 from public.share_links sl where sl.document_id = document_id)
  );

-- share_links
alter table public.share_links enable row level security;

create policy "Users can manage share links for own documents"
  on public.share_links for all
  using (
    exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  );

create policy "Anyone can read share links"
  on public.share_links for select
  using (true);

-- =============================================
-- Storage バケット (pdfs)
-- =============================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Storage ポリシー
create policy "Authenticated users can upload PDFs"
  on storage.objects for insert
  with check (bucket_id = 'pdfs' and auth.uid() is not null);

create policy "Anyone can read PDFs"
  on storage.objects for select
  using (bucket_id = 'pdfs');

create policy "Users can delete own PDFs"
  on storage.objects for delete
  using (bucket_id = 'pdfs' and auth.uid()::text = (storage.foldername(name))[1]);
