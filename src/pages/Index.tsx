import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import WantCard from '@/components/wants/WantCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, ShoppingBag, ArrowRight, Camera, DollarSign, Package, Users, Sparkles, CheckCircle } from 'lucide-react';

interface Want {
  id: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: string;
  max_price: number;
  fulfillment: string;
  location: string | null;
  category: string | null;
  created_at: string;
  offer_count?: number;
  image_url?: string | null;
}

const categories = [
  'All Categories',
  'Jackets & Coats',
  'Tops',
  'Bottoms',
  'Dresses',
  'Shoes',
  'Bags',
  'Accessories',
  'Other',
];

export default function Index() {
  const [wants, setWants] = useState<Want[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [maxPriceFilter, setMaxPriceFilter] = useState<string>('');
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetchWants();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchWants = async () => {
    try {
      const { data, error } = await supabase
        .from('wants')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWants(data || []);
    } catch (error) {
      console.error('Error fetching wants:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredWants = wants.filter((want) => {
    const matchesSearch = 
      want.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (want.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    
    const matchesCategory = 
      selectedCategory === 'All Categories' || want.category === selectedCategory;
    
    const matchesPrice = 
      !maxPriceFilter || want.max_price <= parseFloat(maxPriceFilter);

    return matchesSearch && matchesCategory && matchesPrice;
  });

  // Logged-in user view with wants browsing
  if (user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        
        {/* Hero Section for logged-in users */}
        <section className="bg-gradient-hero border-b">
          <div className="container py-12">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h1 className="font-display text-3xl font-bold mb-2">Browse Wants</h1>
                <p className="text-muted-foreground">Find items people are looking for and make offers</p>
              </div>
              <Button asChild size="lg">
                <Link to="/post-want">
                  <Plus className="mr-2 h-5 w-5" />
                  Post What You Want
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Browse Section */}
        <section className="container py-8">
          <div className="flex flex-col md:flex-row gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by item or brand..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Max price..."
              value={maxPriceFilter}
              onChange={(e) => setMaxPriceFilter(e.target.value)}
              className="w-full md:w-32"
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-64 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredWants.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredWants.map((want) => (
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
                  offerCount={want.offer_count}
                  imageUrl={want.image_url}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-display text-xl font-semibold mb-2">No wants found</h3>
              <p className="text-muted-foreground mb-6">
                {searchQuery || selectedCategory !== 'All Categories'
                  ? 'Try adjusting your filters'
                  : 'Be the first to post what you\'re looking for!'}
              </p>
              <Button asChild>
                <Link to="/post-want">
                  <Plus className="mr-2 h-4 w-4" />
                  Post a Want
                </Link>
              </Button>
            </div>
          )}
        </section>
      </div>
    );
  }

  // Landing page for visitors
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
              <Button asChild size="lg" className="text-lg px-8 py-6">
                <Link to="/auth?signup=true">
                  Get Started Free
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="text-lg px-8 py-6" asChild>
                <a href="#how-it-works">See How It Works</a>
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
          {/* For Buyers */}
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
          <Button asChild size="lg" className="text-lg px-8 py-6">
            <Link to="/auth?signup=true">
              Create Your Free Account
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
