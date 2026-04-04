-- Migration: Create elevenlabs_voices lookup table and seed voices
-- This table stores ElevenLabs voice options that internal users can select from a dropdown

create table public.elevenlabs_voices (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  voice_id    text not null unique,
  created_at  timestamptz default now()
);

-- Seed the initial voices
insert into public.elevenlabs_voices (name, voice_id) values
  ('Rachel', 'U9VgC8Xinl7nnNsyDd3J'),
  ('Megan',  'jQQiXyFE3PBHLF8znAIb'),
  ('Harry',  'uA0L9FxeLpzlG615Ueay');

-- Allow authenticated users to read the voices table
alter table public.elevenlabs_voices enable row level security;

create policy "Authenticated users can read voices"
  on public.elevenlabs_voices for select
  to authenticated
  using (true);
