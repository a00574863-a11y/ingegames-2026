-- Add public roster projections and immutable, private reports. No resets or deletes.
CREATE TABLE public.tournament_reports (
 id uuid PRIMARY KEY,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tournament_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_reports FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.project_tournament_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE roster jsonb; report jsonb;
BEGIN
 IF NEW.data->>'sessionId' IS NULL OR
    NEW.data->'resetRevision' IS DISTINCT FROM OLD.data->'resetRevision' THEN
  NEW.data := NEW.data || jsonb_build_object('sessionId',gen_random_uuid());
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'career',career,'points',points) ORDER BY id),'[]')
 INTO roster FROM public.teams;
 NEW.data := NEW.data || jsonb_build_object('teams',roster);
 IF NEW.data->>'status'='finished' THEN
  SELECT jsonb_build_object(
   'sessionId',NEW.data->'sessionId','phase',NEW.data->'phase',
   'finishedAt',NEW.data->'finishedAt','totals',NEW.data->'finalTotals',
   'byActivity',NEW.data->'byActivity','teams',roster,
   'events',coalesce((SELECT jsonb_agg(to_jsonb(e)-'request_payload' ORDER BY e.created_at,e.id) FROM public.score_events e),'[]'))
  INTO report;
  INSERT INTO public.tournament_reports(id,data) VALUES((NEW.data->>'sessionId')::uuid,report)
  ON CONFLICT(id) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.project_tournament_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER project_tournament_state BEFORE UPDATE ON public.public_state
 FOR EACH ROW EXECUTE FUNCTION public.project_tournament_state();

-- Refresh only the public projection; preserve all competition values and identities.
UPDATE public.public_state SET data=jsonb_set(data,'{revision}',to_jsonb((data->>'revision')::bigint+1)) WHERE id='state';

CREATE FUNCTION public.tournament_report(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='admin' AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo el administrador activo puede descargar resultados.'; END IF;
 SELECT data INTO result FROM public.tournament_reports WHERE id=p_session_id;
 IF result IS NULL THEN RAISE EXCEPTION 'El reporte no existe. Primero finaliza el torneo.'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.tournament_report(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.tournament_report(uuid) TO authenticated;
