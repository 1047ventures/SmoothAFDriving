import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, ArrowRight, Loader2, XCircle } from 'lucide-react';

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const sessionId = searchParams.get('session_id');
  const offerId = searchParams.get('offer_id');

  useEffect(() => {
    if (sessionId && offerId) {
      verifyPaymentServerSide();
    } else {
      setError('Missing payment information');
      setLoading(false);
    }
  }, [sessionId, offerId]);

  const verifyPaymentServerSide = async () => {
    try {
      // Call server-side verification endpoint
      const { data, error: verifyError } = await supabase.functions.invoke('verify-payment', {
        body: { sessionId, offerId }
      });

      if (verifyError) {
        throw new Error(verifyError.message || 'Payment verification failed');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setVerified(true);
    } catch (err) {
      console.error('Payment verification error:', err);
      setError(err instanceof Error ? err.message : 'Payment verification failed. Please contact support.');
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
            ) : error ? (
              <XCircle className="h-16 w-16 mx-auto text-destructive" />
            ) : (
              <CheckCircle className="h-16 w-16 mx-auto text-primary" />
            )}
            <CardTitle className="font-display text-2xl mt-4">
              {loading ? 'Verifying Payment...' : error ? 'Verification Failed' : 'Payment Successful!'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error ? (
              <p className="text-destructive">{error}</p>
            ) : loading ? (
              <p className="text-muted-foreground">
                Securely verifying your payment with our payment provider...
              </p>
            ) : verified ? (
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
            ) : null}

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