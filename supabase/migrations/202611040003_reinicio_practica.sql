-- INGEGAMES 2026
-- Reinicio de prácticas y activación del evento oficial.
-- No ejecutar hasta completar las pruebas.

CREATE OR REPLACE FUNCTION public.manage_practice(
    p_actor uuid,
    p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s jsonb;
    next_revision bigint;
BEGIN
    -- Bloquear el estado para evitar operaciones simultáneas.
    SELECT data INTO STRICT s
    FROM public.public_state
    WHERE id = 'state'
    FOR UPDATE;

    -- Solo el administrador activo puede ejecutar estas acciones.
    IF NOT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = p_actor
          AND role = 'admin'
          AND enabled = true
    ) THEN
        RAISE EXCEPTION 'Solo el administrador puede gestionar prácticas.';
    END IF;

    -- Prohibir cualquier reinicio del evento oficial.
    IF s->>'phase' IS DISTINCT FROM 'practice' THEN
        RAISE EXCEPTION 'El evento oficial no puede reiniciarse.';
    END IF;

    IF p_action NOT IN ('reset_practice', 'start_official') THEN
        RAISE EXCEPTION 'Acción desconocida.';
    END IF;

    next_revision := COALESCE((s->>'revision')::bigint, 0) + 1;

    -- Eliminar únicamente los datos de competencia.
    -- Primero los eventos por sus relaciones con los equipos.
    DELETE FROM public.score_events;
    DELETE FROM public.teams;

    -- Restaurar los resultados y la configuración de presentación.
    s := s
      - 'finalTotals'
      - 'finishedAt'
      || jsonb_build_object(
        'status', 'not_started',
        'totals', jsonb_build_object('IMT', 0, 'IIS', 0, 'IIT', 0),
        'byActivity', jsonb_build_object(
          'pingpong', jsonb_build_object('IMT', 0, 'IIS', 0, 'IIT', 0),
          'futbolito', jsonb_build_object('IMT', 0, 'IIS', 0, 'IIT', 0),
          'videojuegos', jsonb_build_object('IMT', 0, 'IIS', 0, 'IIT', 0),
          'mesa', jsonb_build_object('IMT', 0, 'IIS', 0, 'IIT', 0)
        ),
        'recent', '[]'::jsonb,
        'presets', jsonb_build_array(5, 10, 20, 50),
        'customPoints', false,
        'animations', true,
        'rotation', false,
        'rotationSeconds', 20,
        'reveal', false,
        'sharedWinners', false,
        'tieWinner', '',
        'revision', next_revision
      );

    IF p_action = 'start_official' THEN
        s := jsonb_set(s, '{phase}', '"official"'::jsonb);
    END IF;

    UPDATE public.public_state
    SET data = s,
        updated_at = now()
    WHERE id = 'state';

    -- Conservar una constancia privada de la operación.
    INSERT INTO public.admin_audit(actor, action, payload)
    VALUES (
        p_actor,
        p_action,
        jsonb_build_object(
            'phase', s->>'phase',
            'revision', next_revision
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'phase', s->>'phase'
    );
END;
$$;

-- Impedir llamadas directas desde el navegador.
REVOKE ALL ON FUNCTION public.manage_practice(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.manage_practice(uuid, text)
TO service_role;