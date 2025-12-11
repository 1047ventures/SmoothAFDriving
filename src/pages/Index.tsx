import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { ShoppingBag, ArrowRight, Camera, DollarSign, Package, Users, Sparkles, CheckCircle } from 'lucide-react';

export default function Index() {
  const { user } = useAuth();

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
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">How ThriftMatch Works</h2>
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

      {/* Value Props Section */}
      <section className="bg-muted/50 border-y py-20">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
            <div>
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">
                Why buyers love ThriftMatch
              </h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Set Your Price</h4>
                    <p className="text-muted-foreground">You decide your max budget. Only get offers within your range.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Nationwide Network</h4>
                    <p className="text-muted-foreground">Access thrifters searching stores across the entire country.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Flexible Fulfillment</h4>
                    <p className="text-muted-foreground">Choose local pickup, shipping, or arrange payment your way.</p>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">
                Why thrifters love ThriftMatch
              </h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Earn While You Thrift</h4>
                    <p className="text-muted-foreground">Turn your thrift store trips into income. Find items, make offers, get paid.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Know What's Wanted</h4>
                    <p className="text-muted-foreground">Browse real wants before you hit the store. No guessing what might sell.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Camera className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Quick & Easy</h4>
                    <p className="text-muted-foreground">Snap a photo, set your price, submit. Takes seconds.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">
            Ready to find your perfect thrift?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Join ThriftMatch today and let our community of thrifters do the hunting for you.
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
      </section>
    </div>
  );
}
