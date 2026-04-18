import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center px-4">
        <Link to="/" className="font-bold text-lg tracking-tight">
          <span className="text-smooth">SMOOTH AF</span>DRIVING
        </Link>
      </div>
    </header>
  );
}
