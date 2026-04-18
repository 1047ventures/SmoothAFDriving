import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight } from 'lucide-react';
import { z } from 'zod';

const authSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().optional(),
});

const isValidRedirect = (path: string): boolean => {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.includes('://')) return false;
  if (path.toLowerCase().includes('javascript:')) return false;
  return true;
};

export default function Auth() {
  const [searchParams] = useSearchParams();
  const isSignupMode = searchParams.get('signup') === 'true';
  const rawRedirect = searchParams.get('redirect');
  const redirectTo = (rawRedirect && isValidRedirect(rawRedirect)) ? rawRedirect : '/dashboard';
  const [isLogin, setIsLogin] = useState(!isSignupMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) navigate(redirectTo);
  }, [user, navigate, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const validation = authSchema.safeParse({ email, password, fullName });
    if (!validation.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      validation.error.errors.forEach((err) => {
        if (err.path[0] === 'email') fieldErrors.email = err.message;
        if (err.path[0] === 'password') fieldErrors.password = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: 'Sign in failed',
            description: error.message === 'Invalid login credentials'
              ? 'Invalid email or password.'
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Welcome back!' });
          navigate(redirectTo);
        }
      } else {
        const { error } = await signUp(email, password, fullName);
        if (error) {
          toast({
            title: 'Sign up failed',
            description: error.message.includes('already registered')
              ? 'This email is already registered. Sign in instead.'
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Account created!', description: 'Welcome to Smooth AF Driving.' });
          navigate(redirectTo);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <Link to="/" className="inline-block mb-3">
            <span className="font-bold text-2xl tracking-tight">
              <span className="text-smooth">SMOOTH AF</span>DRIVING
            </span>
          </Link>
          <p className="text-sm text-muted-foreground">
            {isLogin ? 'Welcome back, driver' : 'Create your account'}
          </p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-2xl p-6 border border-border">
          <h2 className="font-bold text-lg mb-5">{isLogin ? 'Sign in' : 'Get started'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
                <Input
                  type="text"
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="bg-secondary border-0"
                />
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Email</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`bg-secondary border-0 ${errors.email ? 'ring-1 ring-destructive' : ''}`}
              />
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`bg-secondary border-0 ${errors.password ? 'ring-1 ring-destructive' : ''}`}
              />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
            </div>
            <Button
              type="submit"
              className="w-full bg-smooth text-background font-bold rounded-xl py-5"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Please wait…' : (isLogin ? 'Sign in' : 'Create account')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-muted-foreground hover:text-smooth transition-colors"
            >
              {isLogin ? "No account? Sign up" : "Have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
