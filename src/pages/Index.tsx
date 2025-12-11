import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/layout/Header';
import WantCard from '@/components/wants/WantCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, ShoppingBag, ArrowRight } from 'lucide-react';

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
    fetchWants();
  }, []);

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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="bg-gradient-hero border-b">
        <div className="container py-16 md:py-24">
          <div className="max-w-3xl mx-auto text-center animate-fade-in">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
              <ShoppingBag className="h-4 w-4" />
              The Reverse Thrift Marketplace
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6 tracking-tight">
              Post what you want.
              <br />
              <span className="text-gradient-primary">Let thrifters find it.</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Tell us what you're looking for, set your price, and let our community of thrifters hunt it down for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {user ? (
                <Button asChild size="lg" className="text-base">
                  <Link to="/post-want">
                    <Plus className="mr-2 h-5 w-5" />
                    Post What You Want
                  </Link>
                </Button>
              ) : (
              <Button asChild size="lg" className="text-base">
                <Link to="/auth?signup=true">
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              )}
              <Button variant="outline" size="lg" className="text-base" asChild>
                <a href="#browse">Browse Wants</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Browse Section */}
      <section id="browse" className="container py-12">
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
            {user && (
              <Button asChild>
                <Link to="/post-want">
                  <Plus className="mr-2 h-4 w-4" />
                  Post a Want
                </Link>
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
