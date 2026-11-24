-- Search never matches people's names (product.md › Search, #45). body_text writes a Mention
-- as @ and the name it was made with, for previews and snippets, so the search vectors of
-- Threads and Thread Responses now read a copy with each Mention taken out. Hand-written in
-- place of the generated drop and re-add, which would also have dropped the GIN indexes.
--
-- text_without_mentions is an ordinary (SECURITY INVOKER) function: it reads only its
-- arguments, so it's IMMUTABLE, as a generated column needs. Longer names go first, so
-- "@Laura" never takes part of "@Laura Gómez".
CREATE FUNCTION public.text_without_mentions(body_text text, body jsonb)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
DECLARE
  name text;
  result text := body_text;
BEGIN
  IF result IS NULL OR body IS NULL THEN
    RETURN result;
  END IF;
  FOR name IN
    SELECT label
      FROM (
        SELECT DISTINCT found.value #>> '{}' AS label
          FROM jsonb_path_query(body, 'lax $.** ? (@.type == "mention").attrs.label') AS found(value)
      ) AS labels
     WHERE label IS NOT NULL AND label <> ''
     ORDER BY length(label) DESC
  LOOP
    result := replace(result, '@' || name, ' ');
  END LOOP;
  RETURN result;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.text_without_mentions(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.text_without_mentions(text, jsonb) TO ping_app, ping_system;--> statement-breakpoint

-- Postgres 17+ rewrites the stored column and rebuilds its index in place. The previous
-- release's code never writes search, so it works against either expression.
ALTER TABLE "thread" ALTER COLUMN "search" SET EXPRESSION AS (to_tsvector('english', title || ' ' || public.text_without_mentions(body_text, body)));--> statement-breakpoint
ALTER TABLE "thread_response" ALTER COLUMN "search" SET EXPRESSION AS (to_tsvector('english', coalesce(public.text_without_mentions(body_text, body), '')));
