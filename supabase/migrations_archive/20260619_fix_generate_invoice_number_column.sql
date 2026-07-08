-- Fix generate_invoice_number referencing non-existent column "last_sequence"
-- The invoice_sequences table actually uses "current_number" instead.

CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_seq  INTEGER;
  v_year TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
BEGIN
  INSERT INTO invoice_sequences (restaurant_id, current_number)
  VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET current_number = invoice_sequences.current_number + 1
  RETURNING current_number INTO v_seq;

  RETURN 'INV-' || v_year || '-' || lpad(v_seq::TEXT, 5, '0');
END;
$$;
