-- Add platform fee tracking to transactions table
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS platform_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
