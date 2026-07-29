-- Migration: Add deactivation_reason to bank_accounts
ALTER TABLE public.bank_accounts 
ADD COLUMN IF NOT EXISTS deactivation_reason text;
