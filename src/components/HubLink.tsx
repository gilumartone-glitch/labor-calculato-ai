import { Link, useLocation } from "react-router-dom";
import { LayoutGrid } from "lucide-react";

type Variant = "ink" | "outline" | "compact";

// Mantiene la firma esistente per retro-compatibilità: ovunque sia importato,
// non renderizza nulla in linea (il pulsante è ora globale e fisso).
export const HubLink = (_props: { variant?: Variant; className?: string } = {}) => null;

export const FloatingHubButton = () => {
  const location = useLocation();
  const hideOn = ["/hub", "/auth", "/"];
  if (hideOn.includes(location.pathname)) return null;

  return (
    <Link
      to="/hub"
      title="Torna all'Hub"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] inline-flex items-center gap-2 px-3 py-1.5 rounded-sm uppercase tracking-wider font-bold text-sm bg-primary text-primary-foreground border-2 border-ink shadow-[3px_3px_0_0_hsl(var(--ink))] hover:bg-ink hover:text-paper transition-colors"
    >
      <LayoutGrid className="w-4 h-4" />
      <span>Hub</span>
    </Link>
  );
};
