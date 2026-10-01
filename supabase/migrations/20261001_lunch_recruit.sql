-- 점심 모집 개편 (2026-10-01)
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 붙여넣고 Run 하세요. 다시 실행해도 안전합니다.
-- 화면(docs/)을 배포하기 전에 먼저 실행해야 합니다. 새 화면은 아래 컬럼과 함수를 씁니다.
--
-- 바뀌는 것
--   1. orders에 모집 정보 5개 컬럼: 모집 마감 시각, 인원 상한, 방식, 메뉴판 링크, 진행 상태
--   2. 참여 인원 상한을 주문마다 다르게, 주문 완료나 정산 끝 상태에서는 참여를 막음
--   3. create_order: 퀴즈를 받지 않고 모집 정보를 받음 (퀴즈는 계좌 등록 때 받음)
--   4. update_settlement: 계좌와 함께 퀴즈 질문, 정답을 받음
--   5. set_order_status: 주문자가 진행 상태를 바꿈

alter table orders add column if not exists deadline_time text;
alter table orders add column if not exists max_participants int not null default 10;
alter table orders add column if not exists order_type text not null default 'delivery';
alter table orders add column if not exists menu_url text;
alter table orders add column if not exists status text not null default 'open';

alter table orders drop constraint if exists orders_max_participants_check;
alter table orders add constraint orders_max_participants_check check (max_participants between 2 and 10);
alter table orders drop constraint if exists orders_order_type_check;
alter table orders add constraint orders_order_type_check check (order_type in ('delivery', 'pickup', 'dine_in'));
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('open', 'ordered', 'done'));

-- 참여 인원 상한은 주문마다, 모집 중일 때만 참여 가능
create or replace function enforce_participant_limit()
returns trigger as $$
declare
  o record;
begin
  select max_participants, status into o from orders where id = new.order_id;
  if o.status is distinct from 'open' then
    raise exception 'ORDER_CLOSED';
  end if;
  if (select count(*) from participants where order_id = new.order_id) >= coalesce(o.max_participants, 10) then
    raise exception 'MAX_PARTICIPANTS_REACHED';
  end if;
  return new;
end;
$$ language plpgsql;

-- 옛 시그니처는 지워야 새 함수와 헷갈리지 않는다
drop function if exists create_order(text, text, date, text, text, text, text);
drop function if exists update_settlement(bigint, text, text, text, text);

create or replace function create_order(
  p_orderer_name text,
  p_store_name text,
  p_order_date date,
  p_order_time text,
  p_pin text,
  p_deadline_time text,
  p_max_participants int,
  p_order_type text,
  p_menu_url text
)
returns table (
  id bigint,
  orderer_name text,
  store_name text,
  order_date date,
  order_time text,
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
  if p_deadline_time is not null and p_deadline_time !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'INVALID_DEADLINE';
  end if;

  insert into orders (
    orderer_name, store_name, order_date, order_time, pin_hash,
    deadline_time, max_participants, order_type, menu_url
  )
  values (
    trim(p_orderer_name), trim(p_store_name), p_order_date, p_order_time,
    crypt(p_pin, gen_salt('bf')),
    p_deadline_time,
    coalesce(p_max_participants, 10),
    coalesce(p_order_type, 'delivery'),
    case when trim(p_menu_url) ~* '^https?://' then trim(p_menu_url) end
  )
  returning orders.id into new_id;

  return query
    select o.id, o.orderer_name, o.store_name, o.order_date, o.order_time, o.created_at
    from orders o where o.id = new_id;
end;
$$;

-- 계좌 저장. 퀴즈가 아직 없는 주문은 질문과 정답이 필수, 이미 있으면 둘 다 채웠을 때만 바꾼다.
create or replace function update_settlement(
  p_order_id bigint,
  p_pin text,
  p_bank_name text,
  p_account_holder text,
  p_account_number text,
  p_quiz_question text,
  p_quiz_answer text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  has_quiz boolean;
  new_quiz boolean := coalesce(trim(p_quiz_question), '') <> '' and coalesce(trim(p_quiz_answer), '') <> '';
begin
  select quiz_answer_hash is not null into has_quiz
  from orders where id = p_order_id and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);
  if not found then
    raise exception 'INVALID_PIN';
  end if;
  if not has_quiz and not new_quiz then
    raise exception 'MISSING_QUIZ';
  end if;

  update orders
  set bank_name = nullif(trim(p_bank_name), ''),
      account_holder = nullif(trim(p_account_holder), ''),
      account_number = nullif(trim(p_account_number), ''),
      quiz_question = case when new_quiz then trim(p_quiz_question) else quiz_question end,
      quiz_answer_hash = case when new_quiz then crypt(lower(trim(p_quiz_answer)), gen_salt('bf')) else quiz_answer_hash end
  where id = p_order_id;
end;
$$;

create or replace function set_order_status(
  p_order_id bigint,
  p_pin text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_status not in ('open', 'ordered', 'done') then
    raise exception 'INVALID_STATUS';
  end if;
  if not exists (
    select 1 from orders where id = p_order_id and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'INVALID_PIN';
  end if;

  update orders set status = p_status where id = p_order_id;
end;
$$;

grant execute on function create_order(text, text, date, text, text, text, int, text, text) to anon, authenticated;
grant execute on function update_settlement(bigint, text, text, text, text, text, text) to anon, authenticated;
grant execute on function set_order_status(bigint, text, text) to anon, authenticated;

-- 공개 조회 컬럼에 모집 정보 추가 (계좌, 해시는 여전히 막힘)
revoke select on orders from anon, authenticated;
grant select (id, orderer_name, store_name, order_date, order_time, quiz_question, created_at,
              deadline_time, max_participants, order_type, menu_url, status)
  on orders to anon, authenticated;
