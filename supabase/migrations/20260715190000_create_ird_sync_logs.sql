-- Create IRD Billing Sync Logs Table for Nepal CBMS compliance
CREATE TABLE IF NOT EXISTS public.ird_sync_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    invoice_number text NOT NULL,
    buyer_pan text,
    total_amount numeric(10,2) NOT NULL,
    taxable_amount numeric(10,2) NOT NULL,
    vat_amount numeric(10,2) NOT NULL,
    sync_status text NOT NULL DEFAULT 'pending', -- 'synced', 'failed', 'pending'
    sync_response text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Index for scanning and retrying failed/pending sync logs
CREATE INDEX IF NOT EXISTS idx_ird_sync_logs_status ON public.ird_sync_logs(restaurant_id, sync_status);
