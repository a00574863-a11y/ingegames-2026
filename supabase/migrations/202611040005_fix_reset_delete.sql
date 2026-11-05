-- Fix compatibility with safeupdate on PostgREST's authenticator role.
-- Definition-only migration: do not invoke manage_practice or delete any rows here.
-- After the locked admin/phase/revision checks, both tables contain only the
-- current practice's operational data. Their primary keys cannot be NULL.
-- Keep child score_events before parent teams; preserve Auth, profiles, slots,
-- private audit and idempotency receipts. Do not disable safeupdate.

CREATE OR REPLACE FUNCTION public.manage_practice(
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

 DELETE FROM public.score_events WHERE id IS NOT NULL;
 DELETE FROM public.teams WHERE id IS NOT NULL;
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
