-- INGEGAMES: install once on an empty Supabase project. No paid extensions.
create table public.public_state (
 id text primary key check (id = 'state'), data jsonb not null,
 updated_at timestamptz not null default now()
);
create table public.users (
 id uuid primary key references auth.users(id), name text not null,
 role text not null check(role in ('admin','judge')), enabled boolean not null default false,
 activities text[] not null default '{}', slot integer unique check(slot between 1 and 9),
 check((role='admin' and slot is null) or (role='judge' and slot is not null))
);
create unique index single_main_admin on public.users(role) where role='admin';
create table public.judge_slots (
 id integer primary key check(id between 1 and 9), uid uuid unique references auth.users(id),
 name text not null, email text not null default '', activities text[] not null default '{}', enabled boolean not null default false
);
create table public.teams (
 id uuid primary key default gen_random_uuid(), name text not null,
 name_key text not null unique, career text not null check(career in ('IMT','IIS','IIT')),
 members text[] not null check(cardinality(members)=4), activities text[] not null,
 active boolean not null default true, points bigint not null default 0 check(points>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.score_events (
 id uuid primary key, team_id uuid not null references public.teams(id), team_name text not null,
 career text not null check(career in ('IMT','IIS','IIT')),
 activity text not null check(activity in ('pingpong','futbolito','videojuegos','mesa')),
 points integer not null check(points between -10000 and 10000 and points<>0),
 judge_id uuid not null references public.users(id), judge_name text not null,
 kind text not null check(kind in ('score','adjustment','reversal')), reason text not null default '',
 request_payload jsonb not null, reverses uuid unique references public.score_events(id),
 reversed_by uuid references public.score_events(id), created_at timestamptz not null default now()
);
create index teams_activities on public.teams using gin(activities);
create index score_events_judge on public.score_events(judge_id,created_at desc);
create table public.admin_audit(id uuid primary key default gen_random_uuid(),actor uuid references public.users(id),action text not null,payload jsonb not null,created_at timestamptz not null default now());
create table public.event_settings(id text primary key,data jsonb not null);
-- Never published to Realtime or granted to browser roles.
create table public.judge_locks(slot integer primary key references public.judge_slots(id),token uuid not null,expires_at timestamptz not null);

insert into public.public_state(id,data) values ('state','{"status":"not_started","totals":{"IMT":0,"IIS":0,"IIT":0},"byActivity":{"pingpong":{"IMT":0,"IIS":0,"IIT":0},"futbolito":{"IMT":0,"IIS":0,"IIT":0},"videojuegos":{"IMT":0,"IIS":0,"IIT":0},"mesa":{"IMT":0,"IIS":0,"IIT":0}},"recent":[],"presets":[5,10,20,50],"customPoints":false,"animations":true,"rotation":false,"rotationSeconds":20,"reveal":false,"sharedWinners":false,"tieWinner":"","revision":0}');
insert into public.judge_slots(id,name) select n,'Juez '||n from generate_series(1,9) n;

create function public.app_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where id=auth.uid() and enabled and role='admin');
$$;
create function public.app_can_read_team(assigned text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where id=auth.uid() and enabled and (role='admin' or activities && assigned));
$$;
create function public.app_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where id=auth.uid() and enabled);
$$;
revoke all on function public.app_is_admin(),public.app_can_read_team(text[]),public.app_enabled() from public,anon,authenticated;
grant execute on function public.app_is_admin(),public.app_can_read_team(text[]),public.app_enabled() to authenticated;

alter table public.public_state enable row level security;
alter table public.users enable row level security;
alter table public.judge_slots enable row level security;
alter table public.teams enable row level security;
alter table public.score_events enable row level security;
alter table public.admin_audit enable row level security;
alter table public.event_settings enable row level security;
alter table public.judge_locks enable row level security;
revoke all on public.public_state,public.users,public.judge_slots,public.teams,public.score_events,public.admin_audit,public.event_settings,public.judge_locks from public,anon,authenticated;
grant select on public.public_state to anon,authenticated;
grant select on public.users,public.judge_slots,public.teams,public.score_events to authenticated;
grant all on public.public_state,public.users,public.judge_slots,public.teams,public.score_events,public.admin_audit,public.event_settings,public.judge_locks to service_role;
create policy public_scores on public.public_state for select to anon,authenticated using(id='state');
create policy own_profile_or_admin on public.users for select to authenticated using(id=auth.uid() or public.app_is_admin());
create policy admin_slots on public.judge_slots for select to authenticated using(public.app_is_admin());
create policy assigned_teams on public.teams for select to authenticated using(public.app_can_read_team(activities));
create policy own_scores_or_admin on public.score_events for select to authenticated using(public.app_is_admin() or (judge_id=auth.uid() and public.app_enabled()));

create function public.app_text(v jsonb,max_length integer default 100) returns text language plpgsql immutable set search_path='' as $$
declare s text;
begin
 if jsonb_typeof(v) is distinct from 'string' then raise exception 'Texto inválido.'; end if;
 s:=btrim(v#>>'{}');
 if length(s)=0 or length(s)>max_length then raise exception 'Texto inválido.'; end if;
 return s;
end;$$;
create function public.app_int(v jsonb,minimum integer,maximum integer) returns integer language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if jsonb_typeof(v) is distinct from 'number' then raise exception 'Cantidad inválida.'; end if;
 n:=(v#>>'{}')::numeric;
 if n<>trunc(n) or n<minimum or n>maximum then raise exception 'Cantidad fuera de rango.'; end if;
 return n::integer;
end;$$;
create function public.app_activities(v jsonb) returns text[] language plpgsql immutable set search_path='' as $$
declare a text[];
begin
 if jsonb_typeof(v) is distinct from 'array' then raise exception 'Actividades inválidas.'; end if;
 select array_agg(public.app_text(value)) into a from jsonb_array_elements(v);
 if coalesce(cardinality(a),0)<1 or not a <@ array['pingpong','futbolito','videojuegos','mesa'] or cardinality(a)<>(select count(distinct x) from unnest(a) x) then raise exception 'Actividades inválidas.'; end if;
 return a;
end;$$;

-- Only the Edge Function's service client can invoke this function. p_actor is
-- derived from Auth.getUser(jwt) on the server, never accepted from request JSON.
create function public.command(p_actor uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor public.users%rowtype; s jsonb; t public.teams%rowtype; original public.score_events%rowtype; prior public.score_events%rowtype;
 op uuid; team_id uuid; a text; pts integer; why text:=''; kind text; fingerprint jsonb; new_name text; assigned text[]; people text[];
 c text; change jsonb:='{}'; field text; next_status text; presets jsonb; n bigint; entries jsonb;
begin
 -- All mutation paths take this lock first, including judge provisioning.
 select data into strict s from public.public_state where id='state' for update;
 select * into actor from public.users where id=p_actor for share;
 if actor.id is null or not actor.enabled then raise exception 'Cuenta no autorizada o desactivada.'; end if;
 if actor.role<>'admin' and p_action<>'score' then raise exception 'Solo administrador.'; end if;
 if p_action in ('score','adjust','reverse') then
  op:=(p_payload->>'operationId')::uuid;
  if op is null then raise exception 'Falta ID de operación.'; end if;
  fingerprint:=jsonb_build_object('action',p_action,'teamId',p_payload->'teamId','activity',p_payload->'activity','points',p_payload->'points','reason',p_payload->'reason','eventId',p_payload->'eventId');
  select * into prior from public.score_events where id=op;
  if found then
   if prior.judge_id<>p_actor or prior.request_payload<>fingerprint then raise exception 'ID de operación reutilizado con otros datos.'; end if;
   return jsonb_build_object('ok',true,'id',op,'duplicate',true);
  end if;
  if s->>'status'='finished' then raise exception 'Resultados congelados.'; end if;
  if p_action='score' and s->>'status'<>'running' then raise exception 'El torneo no está en curso.'; end if;
  if p_action='reverse' then
   why:=public.app_text(p_payload->'reason',500);
   select * into original from public.score_events where id=(p_payload->>'eventId')::uuid for update;
   if original.id is null or original.kind='reversal' or original.reversed_by is not null then raise exception 'La operación no existe o ya fue anulada.'; end if;
   team_id:=original.team_id; a:=original.activity; pts:=-original.points; kind:='reversal';
  else
   team_id:=(p_payload->>'teamId')::uuid; a:=public.app_text(p_payload->'activity');
   if a not in ('pingpong','futbolito','videojuegos','mesa') then raise exception 'Actividad inválida.'; end if;
   pts:=public.app_int(p_payload->'points',case when p_action='adjust' then -10000 else 1 end,10000);
   if pts=0 then raise exception 'Los puntos deben ser distintos de cero.'; end if;
   if actor.role<>'admin' and not a=any(actor.activities) then raise exception 'Actividad no asignada.'; end if;
   if p_action='adjust' then why:=public.app_text(p_payload->'reason',500); kind:='adjustment'; else kind:='score'; end if;
   if p_action='score' and not (s->'presets' @> jsonb_build_array(pts)) and not (s->>'customPoints')::boolean then raise exception 'Cantidad no habilitada.'; end if;
  end if;
  select * into t from public.teams where id=team_id for update;
  if t.id is null then raise exception 'Equipo inexistente.'; end if;
  if p_action<>'reverse' and (not t.active or not a=any(t.activities)) then raise exception 'Equipo retirado o sin esta actividad.'; end if;
  c:=t.career;
  if t.points+pts<0 or (s#>>array['totals',c])::bigint+pts<0 or (s#>>array['byActivity',a,c])::bigint+pts<0 then raise exception 'La operación produciría un total negativo.'; end if;
  insert into public.score_events(id,team_id,team_name,career,activity,points,judge_id,judge_name,kind,reason,request_payload,reverses)
   values(op,t.id,t.name,c,a,pts,p_actor,actor.name,kind,why,fingerprint,original.id);
  if original.id is not null then update public.score_events set reversed_by=op where id=original.id; end if;
  update public.teams set points=points+pts,updated_at=now() where id=t.id;
  s:=jsonb_set(s,array['totals',c],to_jsonb((s#>>array['totals',c])::bigint+pts));
  s:=jsonb_set(s,array['byActivity',a,c],to_jsonb((s#>>array['byActivity',a,c])::bigint+pts));
  entries:=jsonb_build_array(jsonb_build_object('id',op,'career',c,'activity',a,'points',pts))||(s->'recent');
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into entries from jsonb_array_elements(entries) with ordinality x(value,ord) where ord<=8;
  s:=jsonb_set(s,'{recent}',entries);
  s:=jsonb_set(s,'{revision}',to_jsonb((s->>'revision')::bigint+1));
  update public.public_state set data=s,updated_at=now() where id='state';
  return jsonb_build_object('ok',true,'id',op);
 elsif p_action='team' then
  if s->>'status'='finished' then raise exception 'El torneo ha finalizado.'; end if;
  team_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  select * into t from public.teams where id=team_id;
  new_name:=public.app_text(p_payload->'name',80); c:=public.app_text(p_payload->'career'); assigned:=public.app_activities(p_payload->'activities');
  if c not in ('IMT','IIS','IIT') or jsonb_typeof(p_payload->'members') is distinct from 'array' then raise exception 'Carrera y cuatro integrantes requeridos.'; end if;
  select array_agg(public.app_text(value,100)) into people from jsonb_array_elements(p_payload->'members');
  if coalesce(cardinality(people),0)<>4 or (select count(distinct lower(x)) from unnest(people) x)<>4 then raise exception 'Se requieren cuatro integrantes distintos.'; end if;
  if t.id is not null and t.career<>c then raise exception 'La carrera del equipo es inmutable.'; end if;
  if jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'Estado inválido.'; end if;
  begin
   insert into public.teams(id,name,name_key,career,members,activities,active)
    values(team_id,new_name,lower(regexp_replace(normalize(new_name,NFKC),'\s+',' ','g')),c,people,assigned,(p_payload->>'active')::boolean)
    on conflict(id) do update set name=excluded.name,name_key=excluded.name_key,members=excluded.members,activities=excluded.activities,active=excluded.active,updated_at=now();
  exception when unique_violation then raise exception 'Ya existe un equipo con ese nombre.'; end;
  insert into public.admin_audit(actor,action,payload) values(p_actor,p_action,jsonb_build_object('teamId',team_id));
  return jsonb_build_object('ok',true,'id',team_id);
 elsif p_action='settings' then
  foreach field in array array['animations','rotation','customPoints'] loop
   if p_payload ? field then
    if jsonb_typeof(p_payload->field) is distinct from 'boolean' then raise exception 'Configuración inválida.'; end if;
    change:=change||jsonb_build_object(field,p_payload->field);
   end if;
  end loop;
  if p_payload ? 'rotationSeconds' then change:=change||jsonb_build_object('rotationSeconds',public.app_int(p_payload->'rotationSeconds',10,120)); end if;
  if p_payload ? 'presets' then
   presets:=p_payload->'presets';
   if jsonb_typeof(presets) is distinct from 'array' then raise exception 'Lista de puntos inválida.'; end if;
   if jsonb_array_length(presets) not between 1 and 8 then raise exception 'Configura de uno a ocho valores.'; end if;
   select jsonb_agg(distinct public.app_int(value,1,10000)) into presets from jsonb_array_elements(presets);
   change:=change||jsonb_build_object('presets',presets);
  end if;
  if p_payload ? 'status' then
   next_status:=public.app_text(p_payload->'status');
   if not ((s->>'status'='not_started' and next_status='running') or (s->>'status'='running' and next_status in ('paused','finished')) or (s->>'status'='paused' and next_status in ('running','finished'))) then raise exception 'Transición de torneo no permitida.'; end if;
   change:=change||jsonb_build_object('status',next_status);
   if next_status='finished' then change:=change||jsonb_build_object('finalTotals',s->'totals','finishedAt',now()); end if;
  end if;
  foreach field in array array['reveal','sharedWinners'] loop
   if p_payload ? field then
    if s->>'status'<>'finished' or jsonb_typeof(p_payload->field) is distinct from 'boolean' then raise exception 'Primero finaliza el torneo.'; end if;
    change:=change||jsonb_build_object(field,p_payload->field);
    if field='sharedWinners' then change:=change||'{"tieWinner":""}'; end if;
   end if;
  end loop;
  if p_payload ? 'tieWinner' then
   c:=public.app_text(p_payload->'tieWinner'); why:=public.app_text(p_payload->'reason',500);
   select max(value::bigint) into n from jsonb_each_text(s->'totals');
   if s->>'status'<>'finished' or c not in ('IMT','IIS','IIT') or (s#>>array['totals',c])::bigint<>n or (select count(*) from jsonb_each_text(s->'totals') where value::bigint=n)<2 then raise exception 'Selecciona una carrera empatada al finalizar.'; end if;
   change:=change||jsonb_build_object('tieWinner',c,'sharedWinners',false);
  end if;
  if change='{}' then raise exception 'Sin cambios.'; end if;
  update public.public_state set data=s||change||jsonb_build_object('revision',(s->>'revision')::bigint+1),updated_at=now() where id='state';
  insert into public.admin_audit(actor,action,payload) values(p_actor,p_action,jsonb_build_object('changes',change,'reason',why));
  return '{"ok":true}';
 end if;
 raise exception 'Acción desconocida.';
end;$$;

-- Auth changes cannot share a database transaction. A lease serializes updates
-- per judge; access is disabled BEFORE touching Auth and restored only on commit.
create function public.prepare_judge(p_actor uuid,p_slot integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.judge_slots%rowtype; token uuid:=gen_random_uuid();
begin
 perform 1 from public.public_state where id='state' for update;
 if not exists(select 1 from public.users where id=p_actor and enabled and role='admin') then raise exception 'Solo administrador.'; end if;
 select * into j from public.judge_slots where id=p_slot for update;
 if j.uid is null then raise exception 'Primero crea las diez cuentas con el aprovisionador.'; end if;
 if exists(select 1 from public.judge_locks where slot=p_slot and expires_at>now()) then raise exception 'Este juez se está actualizando. Espera un momento.'; end if;
 insert into public.judge_locks values(p_slot,token,now()+interval '2 minutes') on conflict(slot) do update set token=excluded.token,expires_at=excluded.expires_at;
 update public.users set enabled=false where id=j.uid;
 update public.judge_slots set enabled=false where id=p_slot;
 return jsonb_build_object('uid',j.uid,'token',token);
end;$$;
create function public.finish_judge(p_actor uuid,p_slot integer,p_token uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.judge_slots%rowtype; assigned text[]; new_name text; new_email text; v_enabled boolean;
begin
 perform 1 from public.public_state where id='state' for update;
 if not exists(select 1 from public.users where id=p_actor and enabled and role='admin') then raise exception 'Solo administrador.'; end if;
 if not exists(select 1 from public.judge_locks where slot=p_slot and token=p_token and expires_at>now()) then raise exception 'La operación expiró; el juez permanece deshabilitado.'; end if;
 select * into strict j from public.judge_slots where id=p_slot for update;
 assigned:=public.app_activities(p_payload->'activities'); new_name:=public.app_text(p_payload->'name'); new_email:=lower(public.app_text(p_payload->'email',254));
 if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'Estado inválido.'; end if;
 v_enabled:=(p_payload->>'enabled')::boolean;
 update public.users set name=new_name,activities=assigned,enabled=v_enabled where id=j.uid;
 update public.judge_slots set name=new_name,email=new_email,activities=assigned,enabled=v_enabled where id=p_slot;
 delete from public.judge_locks where slot=p_slot;
 insert into public.admin_audit(actor,action,payload) values(p_actor,'judge',jsonb_build_object('slot',p_slot,'enabled',v_enabled,'activities',assigned));
 return '{"ok":true}';
end;$$;
create function public.cancel_judge(p_slot integer,p_token uuid) returns void language sql security definer set search_path='' as $$
 delete from public.judge_locks where slot=p_slot and token=p_token;
$$;

-- Called once by the local provisioning script, after Auth accounts exist.
create function public.bootstrap_accounts(p_accounts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare account jsonb; i integer:=0; assigned text[]; v_uid uuid; v_email text;
begin
 perform 1 from public.public_state where id='state' for update;
 if exists(select 1 from public.users) then raise exception 'El evento ya tiene cuentas; no se sobrescribirán.'; end if;
 if jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts)<>10 then raise exception 'Se requieren exactamente diez cuentas.'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_accounts))<>10 then raise exception 'Cuentas duplicadas.'; end if;
 for account in select value from jsonb_array_elements(p_accounts) loop
  v_uid:=(account->>'id')::uuid; v_email:=lower(public.app_text(account->'email',254));
  if not exists(select 1 from auth.users where id=v_uid and lower(email)=v_email) then raise exception 'Cuenta Auth inexistente o correo incorrecto.'; end if;
  assigned:=case when i=0 then array['pingpong','futbolito','videojuegos','mesa'] else array[(array['pingpong','futbolito','videojuegos','mesa'])[(i-1)%4+1]] end;
  insert into public.users(id,name,role,enabled,activities,slot) values(v_uid,public.app_text(account->'name'),case when i=0 then 'admin' else 'judge' end,true,assigned,case when i=0 then null else i end);
  if i>0 then update public.judge_slots set uid=v_uid,name=account->>'name',email=v_email,activities=assigned,enabled=true where id=i; end if;
  i:=i+1;
 end loop;
 insert into public.event_settings values('provision','{"complete":true}');
 return '{"ok":true}';
end;$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default: explicitly close every RPC.
revoke all on function public.app_text(jsonb,integer),public.app_int(jsonb,integer,integer),public.app_activities(jsonb),public.command(uuid,text,jsonb),public.prepare_judge(uuid,integer),public.finish_judge(uuid,integer,uuid,jsonb),public.cancel_judge(integer,uuid),public.bootstrap_accounts(jsonb) from public,anon,authenticated;
grant execute on function public.command(uuid,text,jsonb),public.prepare_judge(uuid,integer),public.finish_judge(uuid,integer,uuid,jsonb),public.cancel_judge(integer,uuid),public.bootstrap_accounts(jsonb) to service_role;

-- No private audit/lock/settings table enters the public replication feed.
do $$
declare t text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['public_state','users','teams','score_events','judge_slots'] loop
   execute format('alter publication supabase_realtime add table public.%I',t);
  end loop;
 end if;
end;$$;
