import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DollarSign, Check, X } from 'lucide-react';

interface OfferCardProps {
  offer: {
    id: string;
    asking_price: number;
    notes: string | null;
    image_urls: string[];
    payment_preference: string | null;
    status: string;
    created_at: string;
    profiles: {
      full_name: string | null;
      username: string | null;
    } | null;
  };
  isOwner: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
}

const statusStyles: Record<string, string> = {
  pending: 'bg-accent/10 text-accent',
  accepted: 'bg-primary/10 text-primary',
  declined: 'bg-destructive/10 text-destructive',
};

const paymentLabels: Record<string, string> = {
  in_app: 'In-App',
  venmo: 'Venmo',
  cash: 'Cash',
  other: 'Arrange Later',
};

export default function OfferCard({ offer, isOwner, onAccept, onDecline }: OfferCardProps) {
  return (
    <Card className="shadow-card border-0 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex gap-4">
          {/* Images */}
          {offer.image_urls.length > 0 && (
            <div className="flex gap-2 flex-shrink-0">
              {offer.image_urls.slice(0, 2).map((url, i) => (
                <div key={i} className="w-20 h-20 rounded-lg overflow-hidden bg-muted">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
              {offer.image_urls.length > 2 && (
                <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center text-sm text-muted-foreground">
                  +{offer.image_urls.length - 2}
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="font-medium">
                  {offer.profiles?.full_name || offer.profiles?.username || 'Thrifter'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(offer.created_at).toLocaleDateString()}
                </p>
              </div>
              <Badge className={statusStyles[offer.status]}>{offer.status}</Badge>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="font-semibold">${offer.asking_price}</span>
              {offer.payment_preference && (
                <Badge variant="outline" className="text-xs">
                  {paymentLabels[offer.payment_preference] || offer.payment_preference}
                </Badge>
              )}
            </div>

            {offer.notes && (
              <p className="text-sm text-muted-foreground line-clamp-2">{offer.notes}</p>
            )}

            {/* Actions for owner */}
            {isOwner && offer.status === 'pending' && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={onAccept}>
                  <Check className="mr-1 h-4 w-4" />
                  Accept
                </Button>
                <Button size="sm" variant="outline" onClick={onDecline}>
                  <X className="mr-1 h-4 w-4" />
                  Decline
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
