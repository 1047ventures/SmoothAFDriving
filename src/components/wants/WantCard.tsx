import { Link } from 'react-router-dom';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, DollarSign, Package, ImageOff } from 'lucide-react';

interface WantCardProps {
  id: string;
  title: string;
  brand?: string | null;
  size?: string | null;
  condition: string;
  maxPrice: number;
  fulfillment: string;
  location?: string | null;
  category?: string | null;
  createdAt: string;
  offerCount?: number;
  imageUrl?: string | null;
}

const fulfillmentLabels: Record<string, string> = {
  local_pickup: 'Local Pickup',
  shipping: 'Shipping',
  both: 'Pickup or Ship',
};

const conditionColors: Record<string, string> = {
  poor: 'bg-destructive/10 text-destructive',
  fair: 'bg-accent/10 text-accent',
  good: 'bg-primary/10 text-primary',
  great: 'bg-primary/20 text-primary',
  excellent: 'bg-primary/30 text-primary',
};

export default function WantCard({
  id,
  title,
  brand,
  size,
  condition,
  maxPrice,
  fulfillment,
  location,
  category,
  createdAt,
  offerCount = 0,
  imageUrl,
}: WantCardProps) {
  const timeAgo = getTimeAgo(new Date(createdAt));

  return (
    <Link to={`/want/${id}`}>
      <Card className="h-full hover:shadow-elevated transition-all duration-300 hover:-translate-y-1 cursor-pointer border-0 shadow-card overflow-hidden">
        {/* Image Section */}
        <div className="aspect-square bg-muted relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageOff className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
          <Badge 
            variant="secondary" 
            className={`absolute top-2 right-2 ${conditionColors[condition]}`}
          >
            {condition}
          </Badge>
        </div>

        <CardContent className="pt-4">
          <h3 className="font-display font-semibold text-lg line-clamp-2 mb-2">{title}</h3>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {brand && (
              <Badge variant="outline" className="font-normal text-xs">
                {brand}
              </Badge>
            )}
            {size && (
              <Badge variant="outline" className="font-normal text-xs">
                Size: {size}
              </Badge>
            )}
            {category && (
              <Badge variant="outline" className="font-normal text-xs">
                {category}
              </Badge>
            )}
          </div>

          <div className="space-y-1.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">Up to ${maxPrice.toFixed(0)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              <span>{fulfillmentLabels[fulfillment]}</span>
            </div>
            {location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="truncate">{location}</span>
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter className="pt-0 flex items-center justify-between text-sm text-muted-foreground">
          <span>{timeAgo}</span>
          {offerCount > 0 && (
            <Badge variant="secondary" className="bg-accent/10 text-accent">
              {offerCount} offer{offerCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
