-- Add all tables that the app subscribes to via Supabase Realtime postgres_changes.
-- Without this, supabase_realtime publication has puballtables=false and zero tables,
-- so NO realtime events fire for anyone — customers never get session updates,
-- kitchen never sees new orders, waiters never see table/session changes.
ALTER PUBLICATION supabase_realtime
  ADD TABLE public.sessions,
            public.orders,
            public.service_requests,
            public.tables;
