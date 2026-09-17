-- Судейские листы хакатона: хранилище для страницы /scores/.
--
-- Сайт статический и ходит сюда напрямую через REST (fetch) с публичным
-- ключом. Поэтому обе таблицы закрыты для сайта целиком, а работать с ними
-- можно только через три функции внизу — каждая сначала проверяет код судьи:
--
--   jury_submit   сдать лист (повторная сдача заменяет прежний)
--   jury_results  получить итоги; чужие баллы видны только после своей сдачи
--   jury_clear    удалить все сданные листы — только организатору
--
-- Коды судей в репозиторий не попадают: их задают отдельным запросом
-- в SQL Editor, в базе хранится только хеш кода.
--
-- Скрипт можно запускать повторно: он ничего не удаляет.

create extension if not exists pgcrypto with schema extensions;


-- ---------- Таблицы ----------

create table if not exists public.jury_codes (
  judge_id  text primary key,                -- id судьи из content/scores/scores.json
  code_hash text not null,                   -- bcrypt-хеш кода; сам код не хранится
  can_clear boolean not null default false   -- может очистить итоги
);

create table if not exists public.jury_sheets (
  judge_id     text primary key references public.jury_codes (judge_id) on delete cascade,
  scores       jsonb not null,               -- { "idКоманды": { "idКритерия": 1..5 } }
  submitted_at timestamptz not null default now()
);

-- RLS без единой политики = ни чтения, ни записи через API.
alter table public.jury_codes  enable row level security;
alter table public.jury_sheets enable row level security;
revoke all on public.jury_codes, public.jury_sheets from anon, authenticated;


-- ---------- Проверка кода ----------

-- Код можно вводить как угодно: «k7mq 2xra», «K7MQ-2XRA» — сравниваем
-- только буквы и цифры в верхнем регистре.
create or replace function public.jury_normalize(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.jury_code_ok(p_judge text, p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jury_codes c
    where c.judge_id = p_judge
      and c.code_hash = extensions.crypt(public.jury_normalize(p_code), c.code_hash)
  );
$$;


-- ---------- Функции для сайта ----------

create or replace function public.jury_submit(p_judge text, p_code text, p_scores jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  if not public.jury_code_ok(p_judge, p_code) then
    raise exception 'wrong_code';
  end if;
  -- Шесть команд по шесть оценок — это меньше килобайта.
  if jsonb_typeof(p_scores) is distinct from 'object' or octet_length(p_scores::text) > 4000 then
    raise exception 'bad_scores';
  end if;

  insert into public.jury_sheets (judge_id, scores, submitted_at)
  values (p_judge, p_scores, v_at)
  on conflict (judge_id) do update
    set scores = excluded.scores,
        submitted_at = excluded.submitted_at;

  return v_at;
end;
$$;

create or replace function public.jury_results(p_judge text, p_code text)
returns table (judge_id text, scores jsonb, submitted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_submitted boolean;
begin
  if not public.jury_code_ok(p_judge, p_code) then
    raise exception 'wrong_code';
  end if;

  select exists (select 1 from public.jury_sheets s where s.judge_id = p_judge)
  into v_submitted;

  -- Кто сдал — видно всегда. Сами баллы — только тому, кто уже сдал свой
  -- лист: так чужие оценки не подсказывают твои.
  return query
    select s.judge_id,
           case when v_submitted then s.scores end,
           s.submitted_at
    from public.jury_sheets s
    order by s.submitted_at;
end;
$$;

create or replace function public.jury_clear(p_judge text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.jury_code_ok(p_judge, p_code)
     or not exists (select 1 from public.jury_codes c where c.judge_id = p_judge and c.can_clear) then
    raise exception 'not_allowed';
  end if;

  delete from public.jury_sheets s where s.judge_id is not null;
end;
$$;


-- ---------- Права ----------

-- По умолчанию функцию может вызвать кто угодно — сначала закрываем все,
-- потом открываем сайту (роль anon) ровно три.
revoke execute on function
  public.jury_normalize(text),
  public.jury_code_ok(text, text),
  public.jury_submit(text, text, jsonb),
  public.jury_results(text, text),
  public.jury_clear(text, text)
from public, anon, authenticated;

grant execute on function
  public.jury_submit(text, text, jsonb),
  public.jury_results(text, text),
  public.jury_clear(text, text)
to anon;

-- Сразу показать новые функции в REST API.
notify pgrst, 'reload schema';
