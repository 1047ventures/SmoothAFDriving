-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Create a new policy that only allows authenticated users to view profiles
CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);