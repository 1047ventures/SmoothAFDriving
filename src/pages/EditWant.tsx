import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { ArrowLeft, Pencil, Loader2, ImageIcon, Check, X } from 'lucide-react';
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

export default function EditWant() {
  const { id } = useParams<{ id: string }>();
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
  const [isLoading, setIsLoading] = useState(true);
  
  // Image state
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [lastGeneratedTitle, setLastGeneratedTitle] = useState('');

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && id) fetchWant();
  }, [user, id]);

  const fetchWant = async () => {
    try {
      const { data, error } = await supabase
        .from('wants')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast({ title: 'Want not found', variant: 'destructive' });
        navigate('/dashboard');
        return;
      }

      // Check ownership
      if (data.user_id !== user?.id) {
        toast({ title: 'Unauthorized', description: 'You can only edit your own wants.', variant: 'destructive' });
        navigate('/dashboard');
        return;
      }

      setFormData({
        title: data.title,
        description: data.description || '',
        brand: data.brand || '',
        size: data.size || '',
        category: data.category || '',
        condition: data.condition,
        maxPrice: data.max_price.toString(),
        fulfillment: data.fulfillment,
        location: data.location || '',
      });
      setCurrentImage(data.image_url);
      setSelectedImage(data.image_url);
    } catch (error) {
      console.error('Error fetching want:', error);
      toast({ title: 'Error loading want', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const generateImages = async () => {
    const title = formData.title.trim();
    
    if (title.length < 3 || title === lastGeneratedTitle) {
      return;
    }

    setIsGeneratingImages(true);
    setGeneratedImages([]);

    try {
      const response = await supabase.functions.invoke('generate-want-images', {
        body: { title, description: formData.description.trim() || undefined },
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
      const { error } = await supabase
        .from('wants')
        .update({
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          brand: formData.brand.trim() || null,
          size: formData.size.trim() || null,
          category: formData.category,
          condition: formData.condition as "poor" | "fair" | "good" | "great" | "excellent",
          max_price: parseFloat(formData.maxPrice),
          fulfillment: formData.fulfillment as "local_pickup" | "shipping" | "both",
          location: formData.location.trim() || null,
          image_url: selectedImage,
        })
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Want updated!', description: 'Your changes have been saved.' });
      navigate(`/want/${id}`);
    } catch (error: any) {
      toast({
        title: 'Failed to update',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container max-w-2xl py-8">
          <div className="h-96 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

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
                <Pencil className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="font-display text-2xl">Edit Your Want</CardTitle>
                <CardDescription>
                  Update your item details or add an image
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

              {/* Current Image */}
              {currentImage && generatedImages.length === 0 && !isGeneratingImages && (
                <div className="space-y-3">
                  <Label>Current Image</Label>
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      "relative w-32 h-32 rounded-lg overflow-hidden border-2",
                      selectedImage === currentImage ? "border-primary ring-2 ring-primary/20" : "border-border"
                    )}>
                      <img
                        src={currentImage}
                        alt="Current image"
                        className="w-full h-full object-cover"
                      />
                      {selectedImage === currentImage && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="bg-primary text-primary-foreground rounded-full p-1">
                            <Check className="h-4 w-4" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedImage(currentImage)}
                        disabled={selectedImage === currentImage}
                      >
                        Keep Current
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedImage(null)}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Remove Image
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Image Selection Section */}
              {(isGeneratingImages || generatedImages.length > 0) && (
                <div className="space-y-3">
                  <Label>Select a new image</Label>
                  {isGeneratingImages ? (
                    <div className="flex items-center justify-center py-12 bg-muted/50 rounded-lg border border-dashed">
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
                        <p className="text-sm text-muted-foreground">Generating images...</p>
                        <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
                      </div>
                    </div>
                  ) : (
                    <>
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
                      {currentImage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setGeneratedImages([]);
                            setSelectedImage(currentImage);
                          }}
                        >
                          ← Keep current image instead
                        </Button>
                      )}
                    </>
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
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
