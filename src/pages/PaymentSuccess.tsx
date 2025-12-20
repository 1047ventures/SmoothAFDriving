import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, ArrowRight, Loader2 } from 'lucide-react';

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sessionId = searchParams.get('session_id');
  const offerId = searchParams.get('offer_id');

  useEffect(() => {
    if (offerId) {
      updateOfferAndWantStatus();
    } else {
      setLoading(false);
    }
  }, [offerId]);

  const updateOfferAndWantStatus = async () => {
    try {
      // Get offer to find the want_id
      const { data: offer, error: offerError } = await supabase
        .from('offers')
        .select('want_id')
        .eq('id', offerId)
        .single();

      if (offerError) throw offerError;

      // Update offer status to accepted
      await supabase
        .from('offers')
        .update({ status: 'accepted' })
        .eq('id', offerId);

      // Update want status to fulfilled
      await supabase
        .from('wants')
        .update({ status: 'fulfilled' })
        .eq('id', offer.want_id);

    } catch (err) {
      console.error('Error updating status:', err);
      setError('Payment successful but there was an issue updating the order status.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="container max-w-lg py-16">
        <Card className="shadow-elevated border-0 text-center">
          <CardHeader className="pb-4">
            {loading ? (
              <Loader2 className="h-16 w-16 mx-auto text-primary animate-spin" />
            ) : (
              <CheckCircle className="h-16 w-16 mx-auto text-primary" />
            )}
            <CardTitle className="font-display text-2xl mt-4">
              {loading ? 'Processing...' : 'Payment Successful!'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error ? (
              <p className="text-destructive">{error}</p>
            ) : loading ? (
              <p className="text-muted-foreground">
                Confirming your payment and updating your order...
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Your payment is being held securely. The funds will be released to the thrifter
                  once you confirm receipt of your item.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-2">What's next?</p>
                  <ul className="space-y-1 text-left">
                    <li>• The thrifter will be notified of your payment</li>
                    <li>• Arrange pickup or shipping with the thrifter</li>
                    <li>• Confirm receipt to release the payment</li>
                  </ul>
                </div>
              </>
            )}

            <div className="flex flex-col gap-3 pt-4">
              <Button asChild>
                <Link to="/dashboard">
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/browse">Continue Browsing</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
