-- Drop the global unique constraint that restricts invoice numbers table-wide
-- and causes multi-tenant collisions (duplicate key value violates unique constraint "orders_invoice_number_key").
-- The multi-tenant constraint "uq_restaurant_invoice" on (restaurant_id, invoice_number) already exists and is sufficient.
ALTER TABLE public.orders 
DROP CONSTRAINT IF EXISTS orders_invoice_number_key;
