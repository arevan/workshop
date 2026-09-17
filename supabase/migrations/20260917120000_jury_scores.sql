-- Судейские листы хакатона: хранилище для страницы /scores/.
--
-- Сайт статический и ходит сюда напрямую через REST (fetch) с публичным
-- ключом. Таблица для сайта закрыта, работать с ней можно только через
-- три функции:
--
--   jury_submit   сдать лист (повторная сдача заменяет прежний)
--   jury_results  все сданные листы
--   jury_clear    удалить все сданные листы
--
-- Кодов судей нет сознательно: раздел временный, судей четверо.
--
-- Скрипт можно запускать повторно: сданные листы он не трогает.

-- Первая версия была с кодами судей — убираем её, если она есть.
drop function if exists public.jury_submit(text, text, jsonb);
drop function if exists public.jury_results(text, text);
drop function if exists public.jury_clear(text, text);
drop function if exists public.jury_code_ok(text, text);
drop function if exists public.jury_normalize(text);
drop table if exists public.jury_codes cascade;


-- ---------- Таблица ----------

create table if not exists public.jury_sheets (
  judge_id     text primary key,             -- id судьи из content/scores/scores.json
  scores       jsonb not null,               -- { "idКоманды": { "idКритерия": 1..5 } }
  submitted_at timestamptz not null default now()
);

-- RLS без единой политики = ни чтения, ни записи через API напрямую.
alter table public.jury_sheets enable row level security;
revoke all on public.jury_sheets from anon, authenticated;


-- ---------- Функции для сайта ----------

create or replace function public.jury_submit(p_judge text, p_scores jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  -- id судьи — короткое латинское слово, оценки — объект меньше килобайта.
  if coalesce(p_judge, '') !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'bad_judge';
  end if;
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

create or replace function public.jury_results()
returns table (judge_id text, scores jsonb, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.judge_id, s.scores, s.submitted_at
  from public.jury_sheets s
  order by s.submitted_at;
$$;

create or replace function public.jury_clear()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.jury_sheets s where s.judge_id is not null;
$$;


-- ---------- Права ----------

-- По умолчанию функцию может вызвать кто угодно — закрываем
-- и открываем сайту (роль anon) ровно эти три.
revoke execute on function
  public.jury_submit(text, jsonb),
  public.jury_results(),
  public.jury_clear()
from public, anon, authenticated;

grant execute on function
  public.jury_submit(text, jsonb),
  public.jury_results(),
  public.jury_clear()
to anon;

-- Сразу показать новые функции в REST API.
notify pgrst, 'reload schema';
