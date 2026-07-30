-- Create system_advertisements table
CREATE TABLE IF NOT EXISTS public.system_advertisements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    badge TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    cta TEXT NOT NULL,
    link TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.system_advertisements ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users and public visitors can read advertisements
CREATE POLICY "Allow public select on system_advertisements" ON public.system_advertisements
    FOR SELECT USING (true);

-- RLS Policy: Super Admins can manage advertisements (Insert, Update, Delete)
CREATE POLICY "Allow super admin full control on system_advertisements" ON public.system_advertisements
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid() AND r.name = 'super_admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid() AND r.name = 'super_admin'
        )
    );

-- Seed initial default advertisements
INSERT INTO public.system_advertisements (badge, title, description, cta, link)
VALUES
    ('NEW INTEGRATION', 'Supercharge Room Bookings with Booking.com Sync', 'Connect your hotel rooms directory directly to online travel agents for automatic real-time rate updates and zero overbookings.', 'Connect Channels', '/admin/settings'),
    ('HARDWARE CORNER', 'Auto-Print KOTs to Your Thermal Printer', 'Point your 80mm LAN printer at the cashier counter and KOT tickets print the moment an order is confirmed. No manual reprints.', 'Set Up Printer', '/admin/printers'),
    ('SRMS PLATINUM', 'Auto-Backup Data to Google Drive & Dropbox', 'Never worry about server outages or laptop loss. Keep encrypted hourly database backups synced automatically to your own cloud storage.', 'Enable Backups', '/admin/profile')
ON CONFLICT DO NOTHING;
