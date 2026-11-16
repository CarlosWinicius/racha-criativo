-- Racha Criativo: banco de dados no Supabase.
-- Cole TUDO no Supabase > SQL Editor > New query > Run. Pode rodar de novo sem problema.

create extension if not exists pgcrypto;

-- ---------- tabelas ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Racha Criativo' check (char_length(title) between 1 and 60),
  game_date date not null,
  start_time text not null default '16:00',
  end_time text not null default '19:00',
  spots int not null default 18 check (spots between 1 and 100),
  price numeric(8, 2) not null default 0,
  pix_key text not null default '',
  pix_name text not null default '',
  opens_at timestamptz,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null default 'membro' check (kind in ('membro', 'convidado')),
  invited_by text,
  paid text not null default 'no' check (paid in ('no', 'informed', 'confirmed')),
  -- hora do servidor, com microssegundos: é isso que define a ordem da lista
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists entries_one_member on public.entries (list_id, user_id) where kind = 'membro';
create unique index if not exists entries_unique_name on public.entries (list_id, lower(name));
create index if not exists entries_order on public.entries (list_id, created_at);

-- ---------- quem é quem ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'approved' or is_admin from profiles where id = auth.uid()), false)
$$;

-- conta nova -> perfil "aguardando aprovação"
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 40))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- regras de acesso (RLS) ----------
alter table public.profiles enable row level security;
alter table public.lists enable row level security;
alter table public.entries enable row level security;

drop policy if exists "perfil: ver" on public.profiles;
drop policy if exists "perfil: admin altera" on public.profiles;
drop policy if exists "perfil: admin apaga" on public.profiles;
create policy "perfil: ver" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "perfil: admin altera" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "perfil: admin apaga" on public.profiles for delete to authenticated using (public.is_admin());

drop policy if exists "lista: ver" on public.lists;
drop policy if exists "lista: admin cria" on public.lists;
drop policy if exists "lista: admin altera" on public.lists;
drop policy if exists "lista: admin apaga" on public.lists;
create policy "lista: ver" on public.lists for select to authenticated using (public.is_approved());
create policy "lista: admin cria" on public.lists for insert to authenticated with check (public.is_admin());
create policy "lista: admin altera" on public.lists for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "lista: admin apaga" on public.lists for delete to authenticated using (public.is_admin());

-- inscrições: entrar só pelas funções abaixo (que conferem aprovação e horário)
drop policy if exists "inscricao: ver" on public.entries;
drop policy if exists "inscricao: admin altera" on public.entries;
drop policy if exists "inscricao: sair" on public.entries;
create policy "inscricao: ver" on public.entries for select to authenticated using (public.is_approved());
create policy "inscricao: admin altera" on public.entries for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "inscricao: sair" on public.entries for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------- ações ----------
create or replace function public._check_can_join(p_list uuid) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p profiles; l lists;
begin
  select * into p from profiles where id = auth.uid();
  if p.id is null or (p.status <> 'approved' and not p.is_admin) then
    raise exception 'Seu acesso ainda não foi aprovado.';
  end if;
  select * into l from lists where id = p_list;
  if l.id is null then raise exception 'Lista não encontrada.'; end if;
  if l.game_date < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Esse jogo já passou.'; end if;
  if l.opens_at is not null and now() < l.opens_at then raise exception 'A lista ainda não abriu.'; end if;
  return p;
end $$;

create or replace function public.join_list(p_list uuid) returns public.entries
language plpgsql security definer set search_path = public as $$
declare p profiles; e entries;
begin
  p := _check_can_join(p_list);
  begin
    insert into entries (list_id, user_id, name, kind) values (p_list, auth.uid(), p.name, 'membro') returning * into e;
  exception when unique_violation then
    raise exception 'Você já está na lista, ou já tem alguém com o nome "%" nela.', p.name;
  end;
  return e;
end $$;

create or replace function public.add_guest(p_list uuid, p_name text) returns public.entries
language plpgsql security definer set search_path = public as $$
declare p profiles; e entries; n text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
begin
  p := _check_can_join(p_list);
  if n = '' then raise exception 'Escreva o nome do convidado.'; end if;
  if not exists (select 1 from entries where list_id = p_list and user_id = auth.uid() and kind = 'membro') then
    raise exception 'Entre na lista antes de levar convidado.';
  end if;
  begin
    insert into entries (list_id, user_id, name, kind, invited_by) values (p_list, auth.uid(), n, 'convidado', p.name) returning * into e;
  exception when unique_violation then
    raise exception 'Já tem alguém chamado "%" nessa lista.', n;
  end;
  return e;
end $$;

create or replace function public.mark_paid(p_entry uuid) returns void
language sql security definer set search_path = public as $$
  update entries set paid = 'informed' where id = p_entry and user_id = auth.uid() and paid = 'no';
$$;

revoke all on function public._check_can_join(uuid) from public, anon, authenticated;
revoke all on function public.join_list(uuid) from public, anon;
revoke all on function public.add_guest(uuid, text) from public, anon;
revoke all on function public.mark_paid(uuid) from public, anon;
grant execute on function public.join_list(uuid) to authenticated;
grant execute on function public.add_guest(uuid, text) to authenticated;
grant execute on function public.mark_paid(uuid) to authenticated;

-- ---------- tempo real ----------
do $$
begin
  begin alter publication supabase_realtime add table public.lists; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.entries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- ---------- primeiro admin ----------
-- Depois de criar seu usuário em Authentication > Users, rode a linha abaixo
-- trocando SEU-EMAIL e SEU NOME:
-- update public.profiles set is_admin = true, status = 'approved', name = 'SEU NOME'
--   where id = (select id from auth.users where email = 'SEU-EMAIL');

-- =====================================================================
-- Parte 2 (novembro/2026): admin reseta senha e adiciona gente na mão.
-- =====================================================================

-- "avulso" = alguém que o organizador colocou na lista sem conta. Conta como membro.
alter table public.entries drop constraint if exists entries_kind_check;
alter table public.entries add constraint entries_kind_check check (kind in ('membro', 'convidado', 'avulso'));

create or replace function public.admin_add_entry(p_list uuid, p_name text) returns public.entries
language plpgsql security definer set search_path = public as $$
declare e entries; l lists; n text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
begin
  if not is_admin() then raise exception 'Só organizadores podem fazer isso.'; end if;
  if n = '' then raise exception 'Escreva o nome da pessoa.'; end if;
  select * into l from lists where id = p_list;
  if l.id is null then raise exception 'Lista não encontrada.'; end if;
  begin
    insert into entries (list_id, user_id, name, kind, invited_by)
    values (p_list, auth.uid(), n, 'avulso', (select name from profiles where id = auth.uid()))
    returning * into e;
  exception when unique_violation then
    raise exception 'Já tem alguém chamado "%" nessa lista.', n;
  end;
  return e;
end $$;

-- Gera uma senha temporária (ex.: volei4821) para quem esqueceu a senha.
create or replace function public.admin_reset_password(p_user uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare pw text := 'volei' || lpad((floor(random() * 10000))::int::text, 4, '0');
begin
  if not is_admin() then raise exception 'Só organizadores podem fazer isso.'; end if;
  if p_user = auth.uid() then raise exception 'Para trocar a sua senha, use Minha conta.'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now()
    where id = p_user;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  return pw;
end $$;

revoke all on function public.admin_add_entry(uuid, text) from public, anon;
revoke all on function public.admin_reset_password(uuid) from public, anon;
grant execute on function public.admin_add_entry(uuid, text) to authenticated;
grant execute on function public.admin_reset_password(uuid) to authenticated;

-- =====================================================================
-- Parte 3: levantadores e times do dia.
-- =====================================================================
alter table public.profiles add column if not exists is_setter boolean not null default false;
alter table public.entries add column if not exists is_setter boolean not null default false;
alter table public.lists add column if not exists teams jsonb;
alter table public.lists add column if not exists teams_at timestamptz;

-- quem já foi marcado como levantador entra na lista já marcado
create or replace function public.join_list(p_list uuid) returns public.entries
language plpgsql security definer set search_path = public as $$
declare p profiles; e entries;
begin
  p := _check_can_join(p_list);
  begin
    insert into entries (list_id, user_id, name, kind, is_setter)
    values (p_list, auth.uid(), p.name, 'membro', p.is_setter) returning * into e;
  exception when unique_violation then
    raise exception 'Você já está na lista, ou já tem alguém com o nome "%" nela.', p.name;
  end;
  return e;
end $$;

-- =====================================================================
-- Parte 4: tier dos jogadores (1 iniciante, 2 meia bomba, 3 os melhores).
-- Só organizadores leem e escrevem. key = 'u:<id da pessoa>' ou 'e:<id da inscrição>' (convidado/avulso).
-- =====================================================================
create table if not exists public.tiers (
  key text primary key,
  tier int not null check (tier between 1 and 3),
  updated_at timestamptz not null default now()
);
alter table public.tiers enable row level security;
drop policy if exists "tier: so admin" on public.tiers;
create policy "tier: so admin" on public.tiers for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- Parte 5: votação dos melhores do dia e conquistas.
-- Categorias: mvp (melhor do dia), ataque, defesa, bloqueio.
-- Abre na hora do jogo, fecha no dia seguinte às 23:59 (horário de Brasília).
-- O placar só aparece depois que fecha (organizadores veem antes).
-- =====================================================================
create table if not exists public.votes (
  list_id uuid not null references public.lists on delete cascade,
  voter uuid not null references auth.users on delete cascade,
  category text not null default 'mvp' check (category in ('mvp', 'ataque', 'defesa', 'bloqueio')),
  entry_id uuid not null references public.entries on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, voter, category)
);
alter table public.votes enable row level security;
drop policy if exists "voto: ver o meu" on public.votes;
create policy "voto: ver o meu" on public.votes for select to authenticated using (voter = auth.uid() or public.is_admin());

create or replace function public._vote_closes(l public.lists) returns timestamptz
language sql stable as $$ select ((l.game_date + 1) + time '23:59:59') at time zone 'America/Sao_Paulo' $$;

create or replace function public.cast_vote(p_list uuid, p_entry uuid, p_category text) returns void
language plpgsql security definer set search_path = public as $$
declare l lists; e entries;
begin
  if p_category not in ('mvp', 'ataque', 'defesa', 'bloqueio') then raise exception 'Categoria inválida.'; end if;
  select * into l from lists where id = p_list;
  if l.id is null then raise exception 'Lista não encontrada.'; end if;
  if now() < ((l.game_date + l.start_time::time) at time zone 'America/Sao_Paulo') then raise exception 'A votação abre na hora do jogo.'; end if;
  if now() > _vote_closes(l) then raise exception 'A votação já fechou.'; end if;
  if not exists (select 1 from entries where list_id = p_list and user_id = auth.uid() and kind = 'membro') then
    raise exception 'Só quem estava na lista pode votar.';
  end if;
  select * into e from entries where id = p_entry and list_id = p_list;
  if e.id is null then raise exception 'Jogador não encontrado nessa lista.'; end if;
  if e.kind = 'membro' and e.user_id = auth.uid() then raise exception 'Não vale votar em você mesmo.'; end if;
  insert into votes (list_id, voter, category, entry_id) values (p_list, auth.uid(), p_category, p_entry)
  on conflict (list_id, voter, category) do update set entry_id = excluded.entry_id, created_at = now();
end $$;

-- placar por categoria; com a votação aberta, só o total de quem votou (organizadores veem tudo)
create or replace function public.vote_results(p_list uuid)
returns table (category text, entry_id uuid, votes bigint, total_voters bigint, closed boolean)
language plpgsql stable security definer set search_path = public as $$
declare l lists; is_closed boolean; total bigint;
begin
  if not is_approved() then raise exception 'Sem acesso.'; end if;
  select * into l from lists where id = p_list;
  if l.id is null then return; end if;
  is_closed := now() > _vote_closes(l);
  select count(distinct v.voter) into total from votes v where v.list_id = p_list;
  if is_closed or is_admin() then
    return query select v.category, v.entry_id, count(*)::bigint, total, is_closed
      from votes v where v.list_id = p_list group by v.category, v.entry_id order by 1, 3 desc;
    if found then return; end if;
  end if;
  return query select null::text, null::uuid, 0::bigint, total, is_closed;
end $$;

-- conquistas de quem está logado: categorias vencidas (empate conta) e jogos jogados
create or replace function public.my_achievements() returns jsonb
language sql stable security definer set search_path = public as $$
  with closed_lists as (select * from lists l where now() > _vote_closes(l)),
  counts as (select v.list_id, v.category, v.entry_id, count(*) c from votes v join closed_lists cl on cl.id = v.list_id group by 1, 2, 3),
  tops as (select list_id, category, max(c) m from counts group by 1, 2),
  winners as (select c.list_id, c.category, c.entry_id from counts c join tops t using (list_id, category) where c.c = t.m)
  select jsonb_build_object(
    'wins', coalesce((select jsonb_agg(jsonb_build_object('category', w.category, 'date', l.game_date, 'title', l.title) order by l.game_date desc)
      from winners w join entries e on e.id = w.entry_id join lists l on l.id = w.list_id
      where e.user_id = auth.uid() and e.kind = 'membro'), '[]'::jsonb),
    'games', (select count(*) from entries e join lists l on l.id = e.list_id
      where e.user_id = auth.uid() and e.kind = 'membro' and l.game_date < (now() at time zone 'America/Sao_Paulo')::date)
  )
$$;

revoke all on function public.cast_vote(uuid, uuid, text) from public, anon;
revoke all on function public.vote_results(uuid) from public, anon;
revoke all on function public.my_achievements() from public, anon;
grant execute on function public.cast_vote(uuid, uuid, text) to authenticated;
grant execute on function public.vote_results(uuid) to authenticated;
grant execute on function public.my_achievements() to authenticated;

-- =====================================================================
-- Parte 6: organizador coloca na lista alguém que já tem conta.
-- =====================================================================
create or replace function public.admin_add_member(p_list uuid, p_user uuid) returns public.entries
language plpgsql security definer set search_path = public as $$
declare p profiles; l lists; e entries;
begin
  if not is_admin() then raise exception 'Só organizadores podem fazer isso.'; end if;
  select * into l from lists where id = p_list;
  if l.id is null then raise exception 'Lista não encontrada.'; end if;
  select * into p from profiles where id = p_user;
  if p.id is null or p.status <> 'approved' then raise exception 'Essa pessoa não está aprovada.'; end if;
  begin
    insert into entries (list_id, user_id, name, kind, is_setter)
    values (p_list, p_user, p.name, 'membro', p.is_setter) returning * into e;
  exception when unique_violation then
    raise exception '% já está na lista (ou tem alguém com esse nome).', p.name;
  end;
  return e;
end $$;
revoke all on function public.admin_add_member(uuid, uuid) from public, anon;
grant execute on function public.admin_add_member(uuid, uuid) to authenticated;

-- =====================================================================
-- Parte 7: ranking (conquistas de todo mundo aprovado).
-- =====================================================================
create or replace function public.ranking()
returns table (user_id uuid, name text, games bigint, mvp bigint, ataque bigint, defesa bigint, bloqueio bigint)
language sql stable security definer set search_path = public as $$
  with closed_lists as (select * from lists l where now() > _vote_closes(l)),
  counts as (select v.list_id, v.category, v.entry_id, count(*) c from votes v join closed_lists cl on cl.id = v.list_id group by 1, 2, 3),
  tops as (select list_id, category, max(c) m from counts group by 1, 2),
  winners as (select c.list_id, c.category, c.entry_id from counts c join tops t using (list_id, category) where c.c = t.m),
  w as (select e.user_id, wn.category from winners wn join entries e on e.id = wn.entry_id where e.kind = 'membro'),
  g as (select e.user_id, count(*) games from entries e join lists l on l.id = e.list_id
        where e.kind = 'membro' and l.game_date < (now() at time zone 'America/Sao_Paulo')::date group by 1)
  select p.id, p.name, coalesce(g.games, 0),
    (select count(*) from w where w.user_id = p.id and w.category = 'mvp'),
    (select count(*) from w where w.user_id = p.id and w.category = 'ataque'),
    (select count(*) from w where w.user_id = p.id and w.category = 'defesa'),
    (select count(*) from w where w.user_id = p.id and w.category = 'bloqueio')
  from profiles p left join g on g.user_id = p.id
  where p.status = 'approved' and public.is_approved()
$$;
revoke all on function public.ranking() from public, anon;
grant execute on function public.ranking() to authenticated;

-- =====================================================================
-- Parte 8: e-mail no perfil (login com Google) + votações por tipo.
-- =====================================================================
alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email)
  values (new.id, left(coalesce(nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name')), ''), split_part(new.email, '@', 1)), 40), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('mvp','ataque','levantador','defesa','bloqueio','passe','saque','time','outro')),
  title text not null check (char_length(title) between 2 and 60),
  list_id uuid references public.lists(id) on delete set null,
  closes_at timestamptz not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  voter uuid not null references public.profiles(id) on delete cascade,
  target text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
drop policy if exists "votação: ver" on public.polls;
drop policy if exists "votação: admin cria" on public.polls;
drop policy if exists "votação: admin altera" on public.polls;
drop policy if exists "votação: admin apaga" on public.polls;
drop policy if exists "voto da votação: ver o meu" on public.poll_votes;
create policy "votação: ver" on public.polls for select to authenticated using (public.is_approved());
create policy "votação: admin cria" on public.polls for insert to authenticated with check (public.is_admin());
create policy "votação: admin altera" on public.polls for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "votação: admin apaga" on public.polls for delete to authenticated using (public.is_admin());
create policy "voto da votação: ver o meu" on public.poll_votes for select to authenticated using (voter = auth.uid());

-- votar (ou trocar o voto) enquanto a votação está aberta
create or replace function public.cast_poll_vote(p_poll uuid, p_target text) returns void
language plpgsql security definer set search_path = public as $$
declare p polls; l lists; n int;
begin
  if not is_approved() then raise exception 'Sem acesso.'; end if;
  select * into p from polls where id = p_poll;
  if p.id is null then raise exception 'Votação não encontrada.'; end if;
  if now() > p.closes_at then raise exception 'A votação já fechou.'; end if;
  if p.kind = 'time' then
    select * into l from lists where id = p.list_id;
    n := coalesce(jsonb_array_length(l.teams), 0);
    if p_target !~ '^team:[0-9]{1,3}$' then raise exception 'Time não encontrado.'; end if;
    if substr(p_target, 6)::int >= n then raise exception 'Time não encontrado.'; end if;
  else
    if p_target = auth.uid()::text then raise exception 'Não vale votar em você mesmo.'; end if;
    if not exists (select 1 from profiles where id::text = p_target and status = 'approved') then raise exception 'Pessoa não encontrada.'; end if;
    if p.list_id is not null and not exists (select 1 from entries where list_id = p.list_id and user_id::text = p_target and kind = 'membro') then
      raise exception 'Essa pessoa não estava nesse jogo.';
    end if;
  end if;
  insert into poll_votes (poll_id, voter, target) values (p_poll, auth.uid(), p_target)
  on conflict (poll_id, voter) do update set target = excluded.target, created_at = now();
end $$;

-- placar; com a votação aberta, só o total (organizadores veem tudo)
create or replace function public.poll_results(p_poll uuid)
returns table (target text, votes bigint, total_voters bigint, closed boolean)
language plpgsql stable security definer set search_path = public as $$
declare p polls; is_closed boolean; total bigint;
begin
  if not is_approved() then raise exception 'Sem acesso.'; end if;
  select * into p from polls where id = p_poll;
  if p.id is null then return; end if;
  is_closed := now() > p.closes_at;
  select count(*) into total from poll_votes v where v.poll_id = p_poll;
  if is_closed or is_admin() then
    return query select v.target, count(*)::bigint, total, is_closed
      from poll_votes v where v.poll_id = p_poll group by v.target order by 2 desc;
    if found then return; end if;
  end if;
  return query select null::text, 0::bigint, total, is_closed;
end $$;

-- quem ganhou cada votação encerrada (empate conta; "melhor time" vale para todo mundo do time)
create or replace function public.poll_wins()
returns table (user_id uuid, kind text, title text, poll_id uuid, closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  with cp as (select * from polls p where now() > p.closes_at),
  counts as (select v.poll_id, v.target, count(*) c from poll_votes v join cp on cp.id = v.poll_id group by 1, 2),
  tops as (select poll_id, max(c) m from counts group by 1),
  winners as (select c.poll_id, c.target from counts c join tops t using (poll_id) where c.c = t.m),
  people as (
    select w.poll_id, pr.id as uid from winners w join profiles pr on pr.id::text = w.target
    union
    select w.poll_id, e.user_id from winners w
      join cp on cp.id = w.poll_id
      join lists l on l.id = cp.list_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(l.teams) = 'array' then l.teams else '[]'::jsonb end) with ordinality as t(team, idx)
      cross join lateral (select t.team ->> 'setter' as eid union all select jsonb_array_elements_text(t.team -> 'players')) ids
      join entries e on e.id::text = ids.eid and e.kind = 'membro'
      where w.target = 'team:' || (t.idx - 1)
  )
  select pp.uid, cp.kind, cp.title, cp.id, cp.closes_at from people pp join cp on cp.id = pp.poll_id
  where public.is_approved()
$$;

revoke all on function public.cast_poll_vote(uuid, text) from public, anon;
revoke all on function public.poll_results(uuid) from public, anon;
revoke all on function public.poll_wins() from public, anon;
grant execute on function public.cast_poll_vote(uuid, text) to authenticated;
grant execute on function public.poll_results(uuid) to authenticated;
grant execute on function public.poll_wins() to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.polls; exception when duplicate_object then null; end;
end $$;
