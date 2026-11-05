-- Upgrade existing installations; never provision Auth or erase competition data here.
-- The old two-argument RPC cannot safely distinguish retries or stale confirmations.
DROP FUNCTION public.manage_practice(uuid, text);

CREATE TABLE public.practice_requests (
 id uuid PRIMARY KEY,
 actor uuid NOT NULL REFERENCES public.users(id),
 action text NOT NULL CHECK (action IN ('reset_practice', 'start_official')),
 expected_revision bigint NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.practice_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practice_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.practice_requests TO service_role;
-- Private receipts survive resets, like admin_audit; neither is published to Realtime.

ALTER TABLE public.public_state DROP CONSTRAINT ingegames_phase_valid;
ALTER TABLE public.public_state ADD CONSTRAINT ingegames_phase_valid
 CHECK (jsonb_typeof(data->'phase') = 'string'
        AND data->>'phase' IN ('practice', 'official') AND data ? 'phase');

CREATE FUNCTION public.manage_practice(
 p_actor uuid, p_action text, p_operation_id uuid, p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 s jsonb;
 prior public.practice_requests%rowtype;
 result jsonb;
BEGIN
 -- Same first lock as command/prepare_judge/finish_judge. Entire reset is atomic.
 SELECT data INTO STRICT s FROM public.public_state WHERE id = 'state' FOR UPDATE;
 PERFORM 1 FROM public.users WHERE id = p_actor AND role = 'admin' AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo el administrador activo puede gestionar prácticas.'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('reset_practice', 'start_official') THEN
  RAISE EXCEPTION 'Acción desconocida.';
 END IF;
 IF p_operation_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
  RAISE EXCEPTION 'Falta ID de operación o revisión válida.';
 END IF;
 SELECT * INTO prior FROM public.practice_requests WHERE id = p_operation_id;
 IF FOUND THEN
  IF prior.actor <> p_actor OR prior.action <> p_action OR prior.expected_revision <> p_expected_revision THEN
   RAISE EXCEPTION 'ID de operación reutilizado con otros datos.';
  END IF;
  -- A retry only returns its receipt, even if the event has since become official.
  RETURN prior.result || jsonb_build_object('duplicate', true);
 END IF;
 IF s->>'phase' IS DISTINCT FROM 'practice' THEN
  RAISE EXCEPTION 'El evento oficial no puede reiniciarse.';
 END IF;
 IF (s->>'revision')::bigint <> p_expected_revision THEN
  RAISE EXCEPTION 'El torneo cambió. Cierra la confirmación, revisa el estado actualizado y vuelve a confirmar.';
 END IF;

 DELETE FROM public.score_events;
 DELETE FROM public.teams;
 -- Explicit parentheses avoid ambiguity between JSONB subtraction/concatenation.
 s := (s - 'finalTotals' - 'finishedAt') || jsonb_build_object(
  'phase', CASE WHEN p_action = 'start_official' THEN 'official' ELSE 'practice' END,
  'status', 'not_started',
  'totals', jsonb_build_object('IMT',0,'IIS',0,'IIT',0),
  'byActivity', jsonb_build_object(
   'pingpong',jsonb_build_object('IMT',0,'IIS',0,'IIT',0),
   'futbolito',jsonb_build_object('IMT',0,'IIS',0,'IIT',0),
   'videojuegos',jsonb_build_object('IMT',0,'IIS',0,'IIT',0),
   'mesa',jsonb_build_object('IMT',0,'IIS',0,'IIT',0)),
  'recent','[]'::jsonb,'presets',jsonb_build_array(5,10,20,50),
  'customPoints',false,'animations',true,'rotation',false,'rotationSeconds',20,
  'reveal',false,'sharedWinners',false,'tieWinner','',
  'resetRevision',p_expected_revision + 1,'revision',p_expected_revision + 1);
 UPDATE public.public_state SET data = s, updated_at = now() WHERE id = 'state';
 result := jsonb_build_object('ok',true,'phase',s->>'phase','revision',s->'revision');
 INSERT INTO public.admin_audit(actor,action,payload)
 VALUES(p_actor,p_action,jsonb_build_object('operationId',p_operation_id,'phase',s->>'phase','revision',s->'revision'));
 INSERT INTO public.practice_requests(id,actor,action,expected_revision,result)
 VALUES(p_operation_id,p_actor,p_action,p_expected_revision,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_practice(uuid,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_practice(uuid,text,uuid,bigint) TO service_role;

-- Browser roles already cannot mutate state. Close DELETE/TRUNCATE as well, so
-- the service role cannot bypass the irreversible phase by replacing the row.
REVOKE INSERT, DELETE, TRUNCATE ON public.public_state FROM service_role;

-- Preserve existing command contracts and RLS; also revise state on roster writes.
create or replace function public.command(p_actor uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  -- Include roster changes in stale-confirmation detection.
  update public.public_state set data=jsonb_set(s,'{revision}',to_jsonb((s->>'revision')::bigint+1)),updated_at=now() where id='state';
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

