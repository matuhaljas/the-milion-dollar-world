-- Run once in the Supabase SQL editor.
-- Grid: 6 cube faces × 408×408 cells (see lib/grid.ts). A purchase is a w×h block on one face.
create extension if not exists btree_gist;

create table orders (
  id uuid primary key default gen_random_uuid(),
  face int not null check (face between 0 and 5),
  x int not null, y int not null, w int not null, h int not null,
  pixels text not null check (length(pixels) = 6 * w * h and pixels ~ '^[0-9a-f]*$'), -- w*h hex colors, row-major
  name text not null, url text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'hidden')),
  stripe_session_id text,
  expires_at timestamptz not null default now() + interval '35 minutes',
  created_at timestamptz not null default now(),
  rect box generated always as (box(point(x, y), point(x + w - 1, y + h - 1))) stored,
  check (w * h >= 10 and w <= 100 and h <= 100 and x >= 0 and y >= 0 and x + w <= 408 and y + h <= 408),
  -- The database itself refuses to sell the same pixel twice.
  exclude using gist (face with =, rect with &&) where (status in ('pending', 'paid'))
);

alter table orders enable row level security;
create policy "public read paid" on orders for select using (status = 'paid');

-- Moderation: update orders set status = 'hidden' where id = '...';
