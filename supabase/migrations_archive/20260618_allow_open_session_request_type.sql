-- The ring-for-service flow (commit e1a101e) introduced a new service request
-- type 'open_session' (customer asks the waiter to open a session for their
-- table) but the service_requests_request_type_check CHECK constraint was never
-- updated to allow it. Every "Ring for Service" insert therefore failed with:
--   ERROR: new row for relation "service_requests" violates check constraint
--          "service_requests_request_type_check"
-- which left customers unable to request a session.
ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_request_type_check;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_request_type_check
  CHECK (request_type = ANY (ARRAY[
    'call_waiter'::text,
    'request_bill'::text,
    'need_water'::text,
    'clean_table'::text,
    'other'::text,
    'open_session'::text
  ]));
