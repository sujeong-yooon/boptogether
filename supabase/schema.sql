-- 밥투게더 스키마
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 붙여넣고 Run 하세요.
-- (이미 한 번 실행했더라도 그대로 다시 실행하면 됩니다 — 전부 안전하게 재실행 가능하도록 작성됨)

create extension if not exists pgcrypto with schema extensions;

create table if not exists orders (
  id bigint generated always as identity primary key,
  orderer_name text not null,
  store_name text not null,
  order_date date not null,
  order_time text not null,
  bank_name text,
  account_number text,
  account_holder text,
  pin_hash text,
  created_at timestamptz not null default now()
);

alter table orders add column if not exists pin_hash text;

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

-- ── 주문 생성 / 정산 계좌 수정 / 참여자 금액 수정은 아래 함수로만 가능하게 하고,
--    테이블 직접 insert/update는 막습니다. 관리 비밀번호(PIN) 검증도 이 함수들
--    안에서만 이뤄져서, 클라이언트는 해시값을 절대 볼 수 없습니다.

create or replace function create_order(
  p_orderer_name text,
  p_store_name text,
  p_order_date date,
  p_order_time text,
  p_pin text
)
returns table (
  id bigint,
  orderer_name text,
  store_name text,
  order_date date,
  order_time text,
  bank_name text,
  account_number text,
  account_holder text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_id bigint;
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN_FORMAT';
  end if;
  if coalesce(trim(p_orderer_name), '') = '' or coalesce(trim(p_store_name), '') = '' then
    raise exception 'MISSING_FIELDS';
  end if;

  insert into orders (orderer_name, store_name, order_date, order_time, pin_hash)
  values (trim(p_orderer_name), trim(p_store_name), p_order_date, p_order_time, crypt(p_pin, gen_salt('bf')))
  returning orders.id into new_id;

  return query
    select o.id, o.orderer_name, o.store_name, o.order_date, o.order_time,
           o.bank_name, o.account_number, o.account_holder, o.created_at
    from orders o where o.id = new_id;
end;
$$;

create or replace function update_settlement(
  p_order_id bigint,
  p_pin text,
  p_bank_name text,
  p_account_holder text,
  p_account_number text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (
    select 1 from orders where id = p_order_id and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'INVALID_PIN';
  end if;

  update orders
  set bank_name = nullif(trim(p_bank_name), ''),
      account_holder = nullif(trim(p_account_holder), ''),
      account_number = nullif(trim(p_account_number), '')
  where id = p_order_id;
end;
$$;

create or replace function update_participant_amount(
  p_participant_id bigint,
  p_order_id bigint,
  p_pin text,
  p_amount int
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_amount is not null and p_amount < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if not exists (
    select 1 from orders where id = p_order_id and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'INVALID_PIN';
  end if;

  update participants
  set amount = p_amount
  where id = p_participant_id and order_id = p_order_id;
end;
$$;

create or replace function delete_order(
  p_order_id bigint,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (
    select 1 from orders where id = p_order_id and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'INVALID_PIN';
  end if;

  delete from orders where id = p_order_id;
end;
$$;

grant execute on function create_order(text, text, date, text, text) to anon, authenticated;
grant execute on function update_settlement(bigint, text, text, text, text) to anon, authenticated;
grant execute on function update_participant_amount(bigint, bigint, text, int) to anon, authenticated;
grant execute on function delete_order(bigint, text) to anon, authenticated;

-- ── RLS: 링크를 가진 누구나 조회/참여(insert)/참여자 삭제는 가능하지만,
--    주문 생성과 정산 관련 수정은 위 함수를 통해서만 가능합니다.
alter table orders enable row level security;
alter table participants enable row level security;

drop policy if exists "orders_select" on orders;
drop policy if exists "orders_insert" on orders;
drop policy if exists "orders_update" on orders;

create policy "orders_select" on orders for select using (true);
-- insert/update 정책은 만들지 않습니다: 위 SECURITY DEFINER 함수로만 가능하도록 막는 목적

drop policy if exists "participants_select" on participants;
drop policy if exists "participants_insert" on participants;
drop policy if exists "participants_update" on participants;
drop policy if exists "participants_delete" on participants;

create policy "participants_select" on participants for select using (true);
create policy "participants_insert" on participants for insert with check (true);
create policy "participants_delete" on participants for delete using (true);
-- update 정책도 만들지 않습니다: 금액 수정은 update_participant_amount() 함수로만 가능
