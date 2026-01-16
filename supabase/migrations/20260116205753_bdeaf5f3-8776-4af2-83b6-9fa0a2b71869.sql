-- Add DELETE policy for offers table (thrifters can delete their pending offers)
CREATE POLICY "Thrifters can delete own pending offers"
ON public.offers
FOR DELETE
USING (
  auth.uid() = thrifter_id AND
  status = 'pending'
);

-- Improve INSERT policy for offers to enforce server-side validation
-- Users can only create offers on active wants and cannot create duplicate pending offers
DROP POLICY IF EXISTS "Authenticated users can create offers" ON public.offers;

CREATE POLICY "Authenticated users can create offers on active wants"
ON public.offers
FOR INSERT
WITH CHECK (
  auth.uid() = thrifter_id AND
  EXISTS (
    SELECT 1 FROM public.wants
    WHERE id = want_id
    AND status = 'active'
  ) AND
  NOT EXISTS (
    SELECT 1 FROM public.offers existing
    WHERE existing.want_id = offers.want_id
    AND existing.thrifter_id = auth.uid()
    AND existing.status = 'pending'
  )
);