import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, Camera } from 'lucide-react';

interface MakeOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wantId: string;
  maxPrice: number;
  onSuccess: () => void;
}

const paymentOptions = [
  { value: 'in_app', label: 'In-App Payment' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'cash', label: 'Cash (Local)' },
  { value: 'other', label: 'Other / Arrange Later' },
];

export default function MakeOfferDialog({
  open,
  onOpenChange,
  wantId,
  maxPrice,
  onSuccess,
}: MakeOfferDialogProps) {
  const [askingPrice, setAskingPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentPreference, setPaymentPreference] = useState('other');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { user } = useAuth();
  const { toast } = useToast();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + images.length > 5) {
      toast({ title: 'Max 5 images allowed', variant: 'destructive' });
      return;
    }

    const newImages = [...images, ...files];
    setImages(newImages);

    // Generate previews
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviews((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const price = parseFloat(askingPrice);
    if (isNaN(price) || price <= 0) {
      toast({ title: 'Please enter a valid price', variant: 'destructive' });
      return;
    }

    if (images.length === 0) {
      toast({ title: 'Please add at least one photo', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload images
      const imageUrls: string[] = [];
      for (const image of images) {
        const fileName = `${user.id}/${Date.now()}-${image.name}`;
        const { error: uploadError } = await supabase.storage
          .from('offer-images')
          .upload(fileName, image);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('offer-images')
          .getPublicUrl(fileName);

        imageUrls.push(publicUrl);
      }

      // Create offer
      const { error } = await supabase.from('offers').insert([{
        want_id: wantId,
        thrifter_id: user.id,
        asking_price: price,
        notes: notes.trim() || null,
        payment_preference: paymentPreference,
        image_urls: imageUrls,
      }]);

      if (error) throw error;

      toast({ title: 'Offer submitted!', description: 'The buyer will review your offer.' });
      onSuccess();
      
      // Reset form
      setAskingPrice('');
      setNotes('');
      setImages([]);
      setImagePreviews([]);
    } catch (error: any) {
      toast({
        title: 'Failed to submit offer',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Make an Offer</DialogTitle>
          <DialogDescription>
            Found something? Share photos and your asking price (buyer's max: ${maxPrice})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Photos *</Label>
            <div className="grid grid-cols-3 gap-2">
              {imagePreviews.map((preview, index) => (
                <div key={index} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                  <img src={preview} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-1 right-1 p-1 bg-background/80 rounded-full"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {images.length < 5 && (
                <label className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors">
                  <Camera className="h-6 w-6 text-muted-foreground mb-1" />
                  <span className="text-xs text-muted-foreground">Add</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                    multiple
                  />
                </label>
              )}
            </div>
          </div>

          {/* Price */}
          <div className="space-y-2">
            <Label htmlFor="price">Your Asking Price ($) *</Label>
            <Input
              id="price"
              type="number"
              placeholder="40"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Where you found it, condition details, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Payment Preference */}
          <div className="space-y-2">
            <Label>Payment Preference</Label>
            <Select value={paymentPreference} onValueChange={setPaymentPreference}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Submit Offer'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
