-- Retired desk themes must not remain searchable on already published desks.
UPDATE public.desks
SET attributes = ARRAY(
  SELECT attribute
  FROM unnest(attributes) WITH ORDINALITY AS item(attribute, position)
  WHERE attribute NOT LIKE 'theme:%'
  ORDER BY position
)
WHERE EXISTS (
  SELECT 1
  FROM unnest(attributes) AS attribute
  WHERE attribute LIKE 'theme:%'
);
