-- INGEGAMES 2026
-- Migración 002: control de práctica y evento oficial.
-- Esta migración no reinicia ni elimina datos.

ALTER TABLE public.public_state
ADD CONSTRAINT ingegames_phase_valid
CHECK (
  NOT (data ? 'phase')
  OR data->>'phase' IN ('practice', 'official')
);

UPDATE public.public_state
SET
  data = jsonb_set(data, '{phase}', '"practice"'::jsonb),
  updated_at = now()
WHERE id = 'state'
  AND NOT (data ? 'phase');

-- La fase oficial no puede regresar a práctica.
CREATE OR REPLACE FUNCTION public.prevent_official_rollback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.data->>'phase' = 'official'
     AND NEW.data->>'phase' IS DISTINCT FROM 'official'
  THEN
    RAISE EXCEPTION
      'El evento oficial no puede regresar a práctica.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ingegames_prevent_official_rollback
BEFORE UPDATE ON public.public_state
FOR EACH ROW
EXECUTE FUNCTION public.prevent_official_rollback();

REVOKE ALL ON FUNCTION public.prevent_official_rollback()
FROM PUBLIC, anon, authenticated;