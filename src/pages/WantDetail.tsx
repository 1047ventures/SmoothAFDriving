import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import MakeOfferDialog from '@/components/offers/MakeOfferDialog';
import OfferCard from '@/components/offers/OfferCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, MapPin, DollarSign, Package, Calendar, User } from 'lucide-react';

interface Want {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  brand: string | null;
  size: string | null;
  category: string | null;
  condition: string;
  max_price: number;
  fulfillment: string;
  location: string | null;
  status: string;
  created_at: string;
  profiles: {
    full_name: string | null;
    username: string | null;
  } | null;
}

interface Offer {
  id: string;
  asking_price: number;
  notes: string | null;
  image_urls: string[];
  payment_preference: string | null;
  status: string;
  created_at: string;
  thrifter_id: string;
  profiles: {
    full_name: string | null;
    username: string | null;
  } | null;
}

const fulfillmentLabels: Record<string, string> = {
  local_pickup: 'Local Pickup Only',
  shipping: 'Shipping Only',
  both: 'Local Pickup or Shipping',
};

export default function WantDetail() {
  const { id } = useParams<{ id: string }>();
  const [want, setWant] = useState<Want | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOfferDialog, setShowOfferDialog] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();

  const isOwner = user?.id === want?.user_id;
  const hasUserOffered = offers.some((o) => o.thrifter_id === user?.id);

  useEffect(() => {
    if (id) fetchWant();
  }, [id]);

  const fetchWant = async () => {
    try {
      const { data: wantData, error: wantError } = await supabase
        .from('wants')
        .select('*, profiles(full_name, username)')
        .eq('id', id)
        .maybeSingle();

      if (wantError) throw wantError;
      if (!wantData) {
        navigate('/');
        return;
      }
      setWant(wantData);

      // Fetch offers if user is the owner or a thrifter who made an offer
      if (user) {
        const { data: offersData, error: offersError } = await supabase
          .from('offers')
          .select('*, profiles(full_name, username)')
          .eq('want_id', id)
          .order('created_at', { ascending: false });

        if (!offersError) setOffers(offersData || []);
      }
    } catch (error) {
      console.error('Error fetching want:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOfferSubmit = () => {
    setShowOfferDialog(false);
    fetchWant();
  };

  const handleAcceptOffer = async (offerId: string) => {
    try {
      await supabase.from('offers').update({ status: 'accepted' }).eq('id', offerId);
      await supabase.from('wants').update({ status: 'fulfilled' }).eq('id', id);
      fetchWant();
    } catch (error) {
      console.error('Error accepting offer:', error);
    }
  };

  const handleDeclineOffer = async (offerId: string) => {
    try {
      await supabase.from('offers').update({ status: 'declined' }).eq('id', offerId);
      fetchWant();
    } catch (error) {
      console.error('Error declining offer:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-8">
          <div className="h-96 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!want) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="container max-w-4xl py-8">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="shadow-elevated border-0">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-display text-2xl mb-2">{want.title}</CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>{want.profiles?.full_name || want.profiles?.username || 'Anonymous'}</span>
                      <span>•</span>
                      <Calendar className="h-4 w-4" />
                      <span>{new Date(want.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <Badge variant={want.status === 'active' ? 'default' : 'secondary'}>
                    {want.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {want.description && (
                  <p className="text-muted-foreground">{want.description}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {want.brand && <Badge variant="outline">{want.brand}</Badge>}
                  {want.size && <Badge variant="outline">Size: {want.size}</Badge>}
                  {want.category && <Badge variant="outline">{want.category}</Badge>}
                  <Badge variant="secondary" className="capitalize">{want.condition} condition</Badge>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <DollarSign className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Budget</p>
                      <p className="font-semibold">Up to ${want.max_price}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Fulfillment</p>
                      <p className="font-semibold">{fulfillmentLabels[want.fulfillment]}</p>
                    </div>
                  </div>
                </div>

                {want.location && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Location</p>
                      <p className="font-semibold">{want.location}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Offers Section */}
            {user && (isOwner || hasUserOffered) && offers.length > 0 && (
              <div className="mt-6">
                <h3 className="font-display text-lg font-semibold mb-4">
                  {isOwner ? 'Offers' : 'Your Offer'}
                </h3>
                <div className="space-y-4">
                  {offers
                    .filter((o) => isOwner || o.thrifter_id === user.id)
                    .map((offer) => (
                      <OfferCard
                        key={offer.id}
                        offer={offer}
                        isOwner={isOwner}
                        onAccept={() => handleAcceptOffer(offer.id)}
                        onDecline={() => handleDeclineOffer(offer.id)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div>
            <Card className="shadow-card border-0 sticky top-24">
              <CardContent className="pt-6">
                {!user ? (
                  <div className="text-center">
                    <p className="text-muted-foreground mb-4">Sign in to make an offer</p>
                    <Button className="w-full" onClick={() => navigate('/auth')}>
                      Sign In
                    </Button>
                  </div>
                ) : isOwner ? (
                  <div className="text-center">
                    <p className="text-muted-foreground">This is your want listing</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {offers.length} offer{offers.length !== 1 ? 's' : ''} received
                    </p>
                  </div>
                ) : want.status !== 'active' ? (
                  <div className="text-center">
                    <p className="text-muted-foreground">This want has been fulfilled</p>
                  </div>
                ) : hasUserOffered ? (
                  <div className="text-center">
                    <p className="text-muted-foreground">You've already made an offer</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      Found something that matches? Make an offer!
                    </p>
                    <Button className="w-full" onClick={() => setShowOfferDialog(true)}>
                      I Found This!
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <MakeOfferDialog
        open={showOfferDialog}
        onOpenChange={setShowOfferDialog}
        wantId={want.id}
        maxPrice={want.max_price}
        onSuccess={handleOfferSubmit}
      />
    </div>
  );
}
