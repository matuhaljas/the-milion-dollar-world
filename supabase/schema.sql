-- Run once in the Supabase SQL editor.
create extension if not exists btree_gist;

create table orders (
  id uuid primary key default gen_random_uuid(),
  x int not null, y int not null, w int not null, h int not null,
  color text not null, name text not null, url text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'hidden')),
  stripe_session_id text,
  expires_at timestamptz not null default now() + interval '35 minutes',
  created_at timestamptz not null default now(),
  rect box generated always as (box(point(x, y), point(x + w - 1, y + h - 1))) stored,
  check (w * h >= 10 and x >= 0 and y >= 0 and x + w <= 1440 and y + h <= 720),
  -- The database itself refuses to sell the same pixel twice.
  exclude using gist (rect with &&) where (status in ('pending', 'paid'))
);

alter table orders enable row level security;
create policy "public read paid" on orders for select using (status = 'paid');

-- Moderation: update orders set status = 'hidden' where id = '...';
