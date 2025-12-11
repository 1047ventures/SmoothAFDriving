import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import WantCard from '@/components/wants/WantCard';
import OfferCard from '@/components/offers/OfferCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Plus, ShoppingBag, Tag } from 'lucide-react';

interface Want {
  id: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: string;
  max_price: number;
  fulfillment: string;
  location: string | null;
  category: string | null;
  status: string;
  created_at: string;
  image_url?: string | null;
}

interface Offer {
  id: string;
  asking_price: number;
  notes: string | null;
  image_urls: string[];
  payment_preference: string | null;
  status: string;
  created_at: string;
  want_id: string;
  wants: {
    title: string;
    max_price: number;
  } | null;
  profiles: {
    full_name: string | null;
    username: string | null;
  } | null;
}

export default function Dashboard() {
  const [myWants, setMyWants] = useState<Want[]>([]);
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    try {
      // Fetch user's wants
      const { data: wantsData, error: wantsError } = await supabase
        .from('wants')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (!wantsError) setMyWants(wantsData || []);

      // Fetch user's offers
      const { data: offersData, error: offersError } = await supabase
        .from('offers')
        .select('*, wants(title, max_price), profiles(full_name, username)')
        .eq('thrifter_id', user!.id)
        .order('created_at', { ascending: false });

      if (!offersError) setMyOffers(offersData || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="container py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          <Button asChild>
            <Link to="/post-want">
              <Plus className="mr-2 h-4 w-4" />
              Post Want
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="wants" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="wants" className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              My Wants
            </TabsTrigger>
            <TabsTrigger value="offers" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              My Offers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wants" className="animate-fade-in">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-64 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : myWants.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myWants.map((want) => (
                  <WantCard
                    key={want.id}
                    id={want.id}
                    title={want.title}
                    brand={want.brand}
                    size={want.size}
                    condition={want.condition}
                    maxPrice={want.max_price}
                    fulfillment={want.fulfillment}
                    location={want.location}
                    category={want.category}
                    createdAt={want.created_at}
                    imageUrl={want.image_url}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">No wants yet</h3>
                <p className="text-muted-foreground mb-6">
                  Post what you're looking for and let thrifters find it!
                </p>
                <Button asChild>
                  <Link to="/post-want">
                    <Plus className="mr-2 h-4 w-4" />
                    Post Your First Want
                  </Link>
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="offers" className="animate-fade-in">
            {loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : myOffers.length > 0 ? (
              <div className="space-y-4">
                {myOffers.map((offer) => (
                  <div key={offer.id}>
                    <Link 
                      to={`/want/${offer.want_id}`}
                      className="text-sm text-muted-foreground hover:text-primary mb-2 block"
                    >
                      Re: {offer.wants?.title}
                    </Link>
                    <OfferCard offer={offer} isOwner={false} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">No offers yet</h3>
                <p className="text-muted-foreground mb-6">
                  Browse wants and make offers when you find something!
                </p>
                <Button asChild variant="outline">
                  <Link to="/">Browse Wants</Link>
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
