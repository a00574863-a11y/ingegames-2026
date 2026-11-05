-- Read-only fingerprints: verify deployment preserves records without exposing them.
SELECT 'teams' AS entity,count(*) AS records,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS fingerprint FROM public.teams t
UNION ALL SELECT 'score_events',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM public.score_events t
UNION ALL SELECT 'users',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM public.users t
UNION ALL SELECT 'judge_slots',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM public.judge_slots t
UNION ALL SELECT 'competition_state',count(*),md5(coalesce(string_agg((data-'teams'-'sessionId'-'revision')::text,'' ORDER BY id),'')) FROM public.public_state;
