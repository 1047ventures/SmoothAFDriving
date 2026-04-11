import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, User, Sparkles, Upload, Check } from 'lucide-react';

const profileSchema = z.object({
  fullName: z.string().max(100, 'Name must be less than 100 characters').optional().or(z.literal('')),
  username: z.string().max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9_]*$/, 'Username can only contain letters, numbers, and underscores').optional().or(z.literal('')),
  location: z.string().max(100, 'Location must be less than 100 characters').optional().or(z.literal('')),
});

interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  location: string | null;
  avatar_url: string | null;
}

export default function Profile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    location: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Cartoon avatar state
  const [uploadedPhoto, setUploadedPhoto] = useState<string | null>(null);
  const [uploadedMimeType, setUploadedMimeType] = useState<string>('image/jpeg');
  const [generatingCartoons, setGeneratingCartoons] = useState(false);
  const [cartoonOptions, setCartoonOptions] = useState<string[]>([]);
  const [selectedCartoon, setSelectedCartoon] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) fetchProfile();
  }, [user]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setProfile(data);
        setFormData({
          fullName: data.full_name || '',
          username: data.username || '',
          location: data.location || '',
        });
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const validation = profileSchema.safeParse(formData);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.fullName.trim() || null,
          username: formData.username.trim() || null,
          location: formData.location.trim() || null,
        })
        .eq('id', user.id);

      if (error) throw error;
      toast({ title: 'Profile updated!' });
    } catch (error: any) {
      toast({
        title: 'Failed to update',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast({
        title: 'Unsupported format',
        description: 'Please upload a JPG, PNG, or WebP image.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image under 5MB.',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // Strip the data URL prefix to get raw base64
      const base64 = dataUrl.split(',')[1];
      setUploadedPhoto(base64);
      setUploadedMimeType(file.type as 'image/jpeg' | 'image/png' | 'image/webp');
      setCartoonOptions([]);
      setSelectedCartoon(null);
    };
    reader.readAsDataURL(file);
  };

  const generateCartoons = async () => {
    if (!uploadedPhoto || !user) return;

    setGeneratingCartoons(true);
    setCartoonOptions([]);
    setSelectedCartoon(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-want-images', {
        body: { mode: 'cartoon_avatar', imageBase64: uploadedPhoto, mimeType: uploadedMimeType },
      });

      if (error) throw error;
      if (!data?.images?.length) throw new Error('No images returned');

      setCartoonOptions(data.images);
    } catch (error: any) {
      toast({
        title: 'Generation failed',
        description: error.message || 'Could not generate cartoon avatars. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setGeneratingCartoons(false);
    }
  };

  const saveAvatar = async () => {
    if (!selectedCartoon || !user) return;

    setSavingAvatar(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: selectedCartoon })
        .eq('id', user.id);

      if (error) throw error;

      setProfile((prev) => prev ? { ...prev, avatar_url: selectedCartoon } : prev);
      toast({ title: 'Avatar updated!' });
      setCartoonOptions([]);
      setUploadedPhoto(null);
      setSelectedCartoon(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: any) {
      toast({
        title: 'Failed to save avatar',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setSavingAvatar(false);
    }
  };

  const getInitials = () => {
    const name = formData.fullName || formData.username || user?.email || '?';
    return name.slice(0, 2).toUpperCase();
  };

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="container max-w-2xl py-8">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {/* Profile Info Card */}
        <Card className="shadow-elevated border-0 mb-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="font-display text-2xl">Profile</CardTitle>
                <CardDescription>Manage your account information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                {/* Current Avatar Preview */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="Profile avatar" />}
                    <AvatarFallback className="text-lg font-semibold">{getInitials()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">Profile picture</p>
                    <p className="text-xs text-muted-foreground">Generate a cartoon avatar below</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={user.email || ''} disabled className="bg-muted" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={formData.fullName}
                    onChange={(e) => setFormData((p) => ({ ...p, fullName: e.target.value }))}
                    placeholder="Jane Doe"
                    maxLength={100}
                  />
                  {errors.fullName && <p className="text-sm text-destructive">{errors.fullName}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData((p) => ({ ...p, username: e.target.value }))}
                    placeholder="janethrifts"
                    maxLength={30}
                  />
                  {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData((p) => ({ ...p, location: e.target.value }))}
                    placeholder="Brooklyn, NY"
                    maxLength={100}
                  />
                  {errors.location && <p className="text-sm text-destructive">{errors.location}</p>}
                </div>

                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Cartoon Avatar Generator Card */}
        <Card className="shadow-elevated border-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="font-display text-2xl">AI Cartoon Avatar</CardTitle>
                <CardDescription>Upload a photo and get 3 unique cartoon profile pics</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Upload area */}
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoUpload}
                className="hidden"
                id="photo-upload"
              />
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 border-dashed"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploadedPhoto ? 'Photo ready — click to change' : 'Upload your photo'}
              </Button>
              {uploadedPhoto && (
                <p className="text-xs text-center text-muted-foreground">
                  Photo loaded. Hit "Generate" to create your cartoon avatars.
                </p>
              )}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!uploadedPhoto || generatingCartoons}
              onClick={generateCartoons}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {generatingCartoons ? 'Generating cartoons...' : 'Generate 3 Cartoon Avatars'}
            </Button>

            {/* Loading skeleton */}
            {generatingCartoons && (
              <div className="grid grid-cols-3 gap-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            )}

            {/* Cartoon results */}
            {cartoonOptions.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-center">Pick your favorite</p>
                <div className="grid grid-cols-3 gap-3">
                  {cartoonOptions.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedCartoon(url)}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        selectedCartoon === url
                          ? 'border-primary shadow-lg scale-[1.03]'
                          : 'border-transparent hover:border-primary/40'
                      }`}
                    >
                      <img
                        src={url}
                        alt={`Cartoon style ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {selectedCartoon === url && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="bg-primary rounded-full p-1">
                            <Check className="h-4 w-4 text-primary-foreground" />
                          </div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                <Button
                  type="button"
                  className="w-full"
                  disabled={!selectedCartoon || savingAvatar}
                  onClick={saveAvatar}
                >
                  {savingAvatar ? 'Saving...' : 'Use as Profile Picture'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
