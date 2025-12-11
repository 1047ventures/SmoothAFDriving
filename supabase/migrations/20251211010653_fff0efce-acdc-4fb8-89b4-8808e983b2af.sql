-- Drop the existing policy that doesn't validate thrifter_id
DROP POLICY IF EXISTS "Buyers can create transactions" ON public.transactions;

-- Create a new policy that validates both buyer_id AND that thrifter_id matches the actual offer owner
CREATE POLICY "Buyers can create transactions"
ON public.transactions
FOR INSERT
WITH CHECK (
  auth.uid() = buyer_id AND
  thrifter_id = (
    SELECT o.thrifter_id FROM public.offers o WHERE o.id = offer_id
  )
);