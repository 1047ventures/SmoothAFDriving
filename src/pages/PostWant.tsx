import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Sparkles, Loader2, ImageIcon, Check } from 'lucide-react';
import { z } from 'zod';
import { cn } from '@/lib/utils';

const wantSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100, 'Title too long'),
  description: z.string().max(500, 'Description too long').optional(),
  brand: z.string().max(50, 'Brand name too long').optional(),
  size: z.string().max(20, 'Size too long').optional(),
  category: z.string().min(1, 'Please select a category'),
  condition: z.string().min(1, 'Please select condition'),
  maxPrice: z.number().min(1, 'Price must be at least $1').max(10000, 'Price too high'),
  fulfillment: z.string().min(1, 'Please select fulfillment option'),
  location: z.string().max(100, 'Location too long').optional(),
});

const categories = [
  'Jackets & Coats',
  'Tops',
  'Bottoms',
  'Dresses',
  'Shoes',
  'Bags',
  'Accessories',
  'Other',
];

const conditions = ['poor', 'fair', 'good', 'great', 'excellent'];

const fulfillmentOptions = [
  { value: 'local_pickup', label: 'Local Pickup Only' },
  { value: 'shipping', label: 'Shipping Only' },
  { value: 'both', label: 'Either Works' },
];

export default function PostWant() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    brand: '',
    size: '',
    category: '',
    condition: 'good',
    maxPrice: '',
    fulfillment: 'both',
    location: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Image generation state
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [lastGeneratedTitle, setLastGeneratedTitle] = useState('');

  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  const generateImages = async () => {
    const title = formData.title.trim();
    
    if (title.length < 3 || title === lastGeneratedTitle) {
      return;
    }

    setIsGeneratingImages(true);
    setGeneratedImages([]);
    setSelectedImage(null);

    try {
      const response = await supabase.functions.invoke('generate-want-images', {
        body: { title },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to generate images');
      }

      const { images, error } = response.data;
      
      if (error) {
        throw new Error(error);
      }

      if (images && images.length > 0) {
        setGeneratedImages(images);
        setLastGeneratedTitle(title);
        toast({
          title: 'Images generated!',
          description: 'Select the one that best matches what you\'re looking for.',
        });
      } else {
        toast({
          title: 'No images generated',
          description: 'Try a more specific description.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Image generation error:', error);
      toast({
        title: 'Failed to generate images',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingImages(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const validation = wantSchema.safeParse({
      ...formData,
      maxPrice: parseFloat(formData.maxPrice) || 0,
    });

    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('wants').insert([{
        user_id: user!.id,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        brand: formData.brand.trim() || null,
        size: formData.size.trim() || null,
        category: formData.category,
        condition: formData.condition as "poor" | "fair" | "good" | "great" | "excellent",
        max_price: parseFloat(formData.maxPrice),
        fulfillment: formData.fulfillment as "local_pickup" | "shipping" | "both",
        location: formData.location.trim() || null,
        image_url: selectedImage || null,
      }]);

      if (error) throw error;

      toast({ title: 'Want posted!', description: 'Thrifters can now see what you\'re looking for.' });
      navigate('/dashboard');
    } catch (error: any) {
      toast({
        title: 'Failed to post',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="container max-w-2xl py-8">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card className="shadow-elevated border-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="font-display text-2xl">Post What You Want</CardTitle>
                <CardDescription>
                  Describe the item you're looking for and set your budget
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">What are you looking for? *</Label>
                <div className="flex gap-2">
                  <Input
                    id="title"
                    placeholder="e.g., Black North Face Puffer Jacket"
                    value={formData.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    className={cn("flex-1", errors.title && 'border-destructive')}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={generateImages}
                    disabled={isGeneratingImages || formData.title.trim().length < 3}
                    className="shrink-0"
                  >
                    {isGeneratingImages ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    <span className="ml-2 hidden sm:inline">Generate Images</span>
                  </Button>
                </div>
                {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
              </div>

              {/* Image Selection Section */}
              {(isGeneratingImages || generatedImages.length > 0) && (
                <div className="space-y-3">
                  <Label>Select the closest match</Label>
                  {isGeneratingImages ? (
                    <div className="flex items-center justify-center py-12 bg-muted/50 rounded-lg border border-dashed">
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
                        <p className="text-sm text-muted-foreground">Generating images...</p>
                        <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {generatedImages.map((image, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setSelectedImage(image)}
                          className={cn(
                            "relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02]",
                            selectedImage === image
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <img
                            src={image}
                            alt={`Generated option ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {selectedImage === image && (
                            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                              <div className="bg-primary text-primary-foreground rounded-full p-1">
                                <Check className="h-4 w-4" />
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {generatedImages.length > 0 && !selectedImage && (
                    <p className="text-sm text-muted-foreground">
                      Click an image to select it, or continue without one
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="description">Additional Details</Label>
                <Textarea
                  id="description"
                  placeholder="Any specific features, colors, or details..."
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="brand">Brand (optional)</Label>
                  <Input
                    id="brand"
                    placeholder="e.g., North Face"
                    value={formData.brand}
                    onChange={(e) => handleChange('brand', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="size">Size (optional)</Label>
                  <Input
                    id="size"
                    placeholder="e.g., M, 8, 32x30"
                    value={formData.size}
                    onChange={(e) => handleChange('size', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select value={formData.category} onValueChange={(v) => handleChange('category', v)}>
                    <SelectTrigger className={errors.category ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Minimum Condition *</Label>
                  <Select value={formData.condition} onValueChange={(v) => handleChange('condition', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {conditions.map((cond) => (
                        <SelectItem key={cond} value={cond} className="capitalize">{cond}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxPrice">Max Budget ($) *</Label>
                  <Input
                    id="maxPrice"
                    type="number"
                    placeholder="50"
                    value={formData.maxPrice}
                    onChange={(e) => handleChange('maxPrice', e.target.value)}
                    className={errors.maxPrice ? 'border-destructive' : ''}
                  />
                  {errors.maxPrice && <p className="text-sm text-destructive">{errors.maxPrice}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Fulfillment *</Label>
                  <Select value={formData.fulfillment} onValueChange={(v) => handleChange('fulfillment', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fulfillmentOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Your Location (for local pickups)</Label>
                <Input
                  id="location"
                  placeholder="e.g., Brooklyn, NY"
                  value={formData.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
                {isSubmitting ? 'Posting...' : 'Post Want'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
