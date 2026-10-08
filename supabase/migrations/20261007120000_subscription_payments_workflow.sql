-- subscription_payments_workflow
-- Adds the columns needed for a proper payment approval workflow so the
-- super-admin can approve a pending payment in one click and the restaurant
-- tier is immediately unlocked.
--
-- Previously subscription_payments had no status column — a payment record
-- was purely informational, and upgrading a tier required the super-admin to
-- navigate to a separate form and type in the restaurant name manually.
-- Now: customer submits a reference → row lands as 'pending' → super-admin
-- sees the row with an Approve button → one click writes 'approved', calls
-- the tier-upgrade logic, and sets subscription_expires_at.

ALTER TABLE public.subscription_payments
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status = ANY(ARRAY['pending', 'approved', 'rejected'])),
    ADD COLUMN IF NOT EXISTS plan_tier TEXT
        CHECK (plan_tier IS NULL OR plan_tier = ANY(ARRAY['basic', 'premium', 'platinum', 'enterprise'])),
    ADD COLUMN IF NOT EXISTS billing_months INTEGER DEFAULT 12
        CHECK (billing_months > 0),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Fast access for the pending-queue view.
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status_created
    ON public.subscription_payments (status, created_at DESC);

-- Mark any existing rows as approved so the queue starts clean.
UPDATE public.subscription_payments
SET status = 'approved'
WHERE status = 'pending';
