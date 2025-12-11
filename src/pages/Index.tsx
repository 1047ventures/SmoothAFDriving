import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import WantCard from '@/components/wants/WantCard';
import { ShoppingBag, ArrowRight, Camera, CheckCircle, Sparkles, Zap, Target, TrendingUp } from 'lucide-react';

export default function Index() {
  const { user } = useAuth();

  const { data: previewWants = [] } = useQuery({
    queryKey: ['preview-wants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wants')
        .select('*, profiles(username, avatar_url)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(6);
      
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="bg-gradient-hero border-b">
        <div className="container py-20 md:py-32">
          <div className="max-w-4xl mx-auto text-center animate-fade-in">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
              <Sparkles className="h-4 w-4" />
              The Reverse Thrift Marketplace
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6 tracking-tight">
              Stop searching.
              <br />
              <span className="text-gradient-primary">Start finding.</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Tell us exactly what you want, and let thrifters across the country hunt it down for you. No more endless scrolling—just post and wait for offers.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {user ? (
                <Button asChild size="lg" className="text-lg px-8 py-6">
                  <Link to="/post-want">
                    Post What You Want
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="lg" className="text-lg px-8 py-6">
                  <Link to="/auth?signup=true">
                    Get Started Free
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              )}
              <Button variant="outline" size="lg" className="text-lg px-8 py-6" asChild>
                <Link to="/browse">Browse Wants</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="container py-20">
        <div className="text-center mb-16">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">How ReverseThrift Works</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We flip thrifting on its head. Instead of sellers posting items hoping someone buys, buyers post what they want and thrifters find it.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="bg-card border rounded-2xl p-8 text-center hover:shadow-lg transition-shadow">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShoppingBag className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold mb-3">1. Post Your Want</h3>
            <p className="text-muted-foreground">
              Describe exactly what you're looking for—brand, size, condition, and your max budget. AI generates images to help thrifters visualize it.
            </p>
          </div>

          <div className="bg-card border rounded-2xl p-8 text-center hover:shadow-lg transition-shadow">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Camera className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold mb-3">2. Thrifters Hunt</h3>
            <p className="text-muted-foreground">
              Our community of thrifters browses stores with your wants in mind. When they spot a match, they snap photos and make you an offer.
            </p>
          </div>

          <div className="bg-card border rounded-2xl p-8 text-center hover:shadow-lg transition-shadow">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold mb-3">3. Accept & Receive</h3>
            <p className="text-muted-foreground">
              Review offers, accept the one you love, and arrange payment and delivery—whether local meetup or shipping. Simple as that.
            </p>
          </div>
        </div>
      </section>

      {/* Modern Value Props Section */}
      <section className="bg-muted/30 border-y py-20">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">Built for Everyone</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Whether you're hunting for hidden gems or making money from your thrift expertise.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            <div className="group relative bg-card border rounded-2xl p-6 hover:border-primary/50 transition-all hover:-translate-y-1">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <Target className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">Precision Matching</h3>
                <p className="text-sm text-muted-foreground">Set your exact specs—brand, size, condition, budget. Only see what you actually want.</p>
              </div>
            </div>

            <div className="group relative bg-card border rounded-2xl p-6 hover:border-primary/50 transition-all hover:-translate-y-1">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">Zero Effort</h3>
                <p className="text-sm text-muted-foreground">Post once, sit back. Thrifters do the hunting while you wait for offers to roll in.</p>
              </div>
            </div>

            <div className="group relative bg-card border rounded-2xl p-6 hover:border-primary/50 transition-all hover:-translate-y-1">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">Earn While You Shop</h3>
                <p className="text-sm text-muted-foreground">Already hitting thrift stores? Get paid for finds you spot that match buyer wants.</p>
              </div>
            </div>

            <div className="group relative bg-card border rounded-2xl p-6 hover:border-primary/50 transition-all hover:-translate-y-1">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">AI-Powered</h3>
                <p className="text-sm text-muted-foreground">Visual want previews generated instantly so thrifters know exactly what to look for.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Preview Wants Section */}
      {previewWants.length > 0 && (
        <section className="container py-20">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">Live Wants</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Real people looking for real items right now. Can you find what they need?
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto mb-10">
            {previewWants.map((want) => (
              <WantCard
                key={want.id}
                id={want.id}
                title={want.title}
                brand={want.brand}
                size={want.size}
                condition={want.condition}
                maxPrice={want.max_price}
                fulfillment={want.fulfillment}
                location={want.location}
                category={want.category}
                createdAt={want.created_at}
                imageUrl={want.image_url}
              />
            ))}
          </div>

          <div className="text-center">
            <Button asChild size="lg" variant="outline" className="text-lg px-8">
              <Link to="/browse">
                Browse All Wants
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* CTA Section */}
      <section className="bg-primary/5 border-t py-20">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">
              Ready to find your perfect thrift?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Join ReverseThrift today and let our community of thrifters do the hunting for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {user ? (
                <Button asChild size="lg" className="text-lg px-8 py-6">
                  <Link to="/browse">
                    Browse Wants
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="lg" className="text-lg px-8 py-6">
                  <Link to="/auth?signup=true">
                    Create Your Free Account
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
