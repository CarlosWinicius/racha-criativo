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
