-- Create enum for want status
CREATE TYPE public.want_status AS ENUM ('active', 'fulfilled', 'cancelled');

-- Create enum for offer status
CREATE TYPE public.offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired');

-- Create enum for transaction status
CREATE TYPE public.transaction_status AS ENUM ('pending_payment', 'paid', 'shipped', 'completed', 'cancelled');

-- Create enum for fulfillment type
CREATE TYPE public.fulfillment_type AS ENUM ('local_pickup', 'shipping', 'both');

-- Create enum for condition
CREATE TYPE public.item_condition AS ENUM ('poor', 'fair', 'good', 'great', 'excellent');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create wants table
CREATE TABLE public.wants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  size TEXT,
  category TEXT,
  condition item_condition NOT NULL DEFAULT 'good',
  max_price DECIMAL(10,2) NOT NULL,
  fulfillment fulfillment_type NOT NULL DEFAULT 'both',
  location TEXT,
  status want_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create offers table
CREATE TABLE public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  want_id UUID REFERENCES public.wants(id) ON DELETE CASCADE NOT NULL,
  thrifter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  asking_price DECIMAL(10,2) NOT NULL,
  notes TEXT,
  image_urls TEXT[] DEFAULT '{}',
  payment_preference TEXT,
  status offer_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create transactions table
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID REFERENCES public.offers(id) ON DELETE CASCADE NOT NULL UNIQUE,
  buyer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  thrifter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  fulfillment_method fulfillment_type NOT NULL,
  shipping_address TEXT,
  meetup_location TEXT,
  status transaction_status NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Wants policies
CREATE POLICY "Active wants are viewable by everyone" 
ON public.wants FOR SELECT USING (true);

CREATE POLICY "Users can create own wants" 
ON public.wants FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wants" 
ON public.wants FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own wants" 
ON public.wants FOR DELETE USING (auth.uid() = user_id);

-- Offers policies
CREATE POLICY "Offers viewable by want owner and thrifter" 
ON public.offers FOR SELECT USING (
  auth.uid() IN (
    SELECT user_id FROM public.wants WHERE id = want_id
  ) OR auth.uid() = thrifter_id
);

CREATE POLICY "Authenticated users can create offers" 
ON public.offers FOR INSERT WITH CHECK (auth.uid() = thrifter_id);

CREATE POLICY "Thrifters can update own offers" 
ON public.offers FOR UPDATE USING (auth.uid() = thrifter_id);

CREATE POLICY "Want owners can update offer status" 
ON public.offers FOR UPDATE USING (
  auth.uid() IN (SELECT user_id FROM public.wants WHERE id = want_id)
);

-- Transactions policies
CREATE POLICY "Transaction participants can view" 
ON public.transactions FOR SELECT USING (
  auth.uid() = buyer_id OR auth.uid() = thrifter_id
);

CREATE POLICY "Buyers can create transactions" 
ON public.transactions FOR INSERT WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Participants can update transactions" 
ON public.transactions FOR UPDATE USING (
  auth.uid() = buyer_id OR auth.uid() = thrifter_id
);

-- Create function to handle new user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;

-- Create trigger for new user profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_wants_updated_at
  BEFORE UPDATE ON public.wants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_offers_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for offer images
INSERT INTO storage.buckets (id, name, public) VALUES ('offer-images', 'offer-images', true);

-- Storage policies for offer images
CREATE POLICY "Anyone can view offer images"
ON storage.objects FOR SELECT
USING (bucket_id = 'offer-images');

CREATE POLICY "Authenticated users can upload offer images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'offer-images' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their own offer images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'offer-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own offer images"
ON storage.objects FOR DELETE
USING (bucket_id = 'offer-images' AND auth.uid()::text = (storage.foldername(name))[1]);