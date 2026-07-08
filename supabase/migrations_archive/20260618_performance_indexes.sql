-- Migration: Add indexes for performance
-- Designed to speed up Waiter and Kitchen dashboard loads

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_payment ON orders(restaurant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders(session_id);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_restaurant_status_table ON sessions(restaurant_id, status, table_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions(session_token);

-- Service Requests
CREATE INDEX IF NOT EXISTS idx_service_requests_restaurant_status ON service_requests(restaurant_id, status);

-- Menu Items
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_available ON menu_items(restaurant_id, is_available);

-- Tables
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_active ON tables(restaurant_id, is_active);
