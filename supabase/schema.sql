-- 밥투게더 스키마
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 붙여넣고 Run 하세요.

create table if not exists orders (
  id bigint generated always as identity primary key,
  orderer_name text not null,
  store_name text not null,
  order_date date not null,
  order_time text not null,
  bank_name text,
  account_number text,
  account_holder text,
  created_at timestamptz not null default now()
);

create table if not exists participants (
  id bigint generated always as identity primary key,
  order_id bigint not null references orders(id) on delete cascade,
  name text not null,
  menu text not null,
  amount integer check (amount is null or amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_date on orders(order_date);
create index if not exists idx_participants_order on participants(order_id);

-- 참여자는 주문 하나당 최대 10명
create or replace function enforce_participant_limit()
returns trigger as $$
begin
  if (select count(*) from participants where order_id = new.order_id) >= 10 then
    raise exception 'MAX_PARTICIPANTS_REACHED';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_participant_limit on participants;
create trigger trg_participant_limit
before insert on participants
for each row execute function enforce_participant_limit();

-- 링크를 가진 누구나 읽고 쓸 수 있도록 허용 (로그인 없는 소규모 그룹 도구)
alter table orders enable row level security;
alter table participants enable row level security;

drop policy if exists "orders_select" on orders;
drop policy if exists "orders_insert" on orders;
drop policy if exists "orders_update" on orders;

create policy "orders_select" on orders for select using (true);
create policy "orders_insert" on orders for insert with check (true);
create policy "orders_update" on orders for update using (true) with check (true);

drop policy if exists "participants_select" on participants;
drop policy if exists "participants_insert" on participants;
drop policy if exists "participants_update" on participants;
drop policy if exists "participants_delete" on participants;

create policy "participants_select" on participants for select using (true);
create policy "participants_insert" on participants for insert with check (true);
create policy "participants_update" on participants for update using (true) with check (true);
create policy "participants_delete" on participants for delete using (true);
