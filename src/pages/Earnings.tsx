import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, ShoppingBag } from 'lucide-react';

const ADMIN_EMAIL = 'skellyslife@gmail.com';

interface EarningsData {
  totalGmv: number;
  totalFees: number;
  transactionCount: number;
  monthly: { month: string; gmv: number; fees: number; count: number }[];
}

function formatMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-');
  return new Date(Number(year), Number(month) - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
}

export default function Earnings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.email !== ADMIN_EMAIL) {
      navigate('/');
      return;
    }
    fetchEarnings();
  }, [user, authLoading]);

  const fetchEarnings = async () => {
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        'get-platform-earnings'
      );
      if (fnError) throw fnError;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-8 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-8">
          <p className="text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container max-w-4xl py-8 space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold">Platform Earnings</h1>
          <p className="text-muted-foreground mt-1">Revenue from 12% service fees on all transactions</p>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-0 shadow-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Total Platform Fees
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">${data.totalFees.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">12% of all completed sales</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Total GMV
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">${data.totalGmv.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Gross merchandise value</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Transactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{data.transactionCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Completed sales</p>
            </CardContent>
          </Card>
        </div>

        {/* Monthly breakdown */}
        {data.monthly.length > 0 && (
          <Card className="border-0 shadow-elevated">
            <CardHeader>
              <CardTitle>Monthly Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {data.monthly.map((m) => (
                  <div key={m.month} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{formatMonth(m.month)}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.count} transaction{m.count !== 1 ? 's' : ''} · ${m.gmv.toFixed(2)} GMV
                      </p>
                    </div>
                    <p className="font-semibold text-primary">+${m.fees.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {data.monthly.length === 0 && (
          <Card className="border-0 shadow-elevated">
            <CardContent className="py-12 text-center text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>No completed transactions yet.</p>
              <p className="text-sm mt-1">Earnings will appear here once buyers complete in-app payments.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
