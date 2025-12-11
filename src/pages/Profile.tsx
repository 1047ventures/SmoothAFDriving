import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, User } from 'lucide-react';

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

    // Validate inputs
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

  if (authLoading || !user) return null;

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
      </div>
    </div>
  );
}
