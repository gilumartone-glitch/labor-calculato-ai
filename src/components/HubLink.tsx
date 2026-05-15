import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutGrid } from "lucide-react";

type Variant = "ink" | "outline" | "compact";

// Retro-compatibilità: il pulsante è ora globale e fisso.
export const HubLink = (_props: { variant?: Variant; className?: string } = {}) => null;

export const FloatingHubButton = () => {
  const location = useLocation();
  const hideOn = ["/hub", "/auth", "/"];
  const hidden = hideOn.includes(location.pathname);

  useEffect(() => {
    if (hidden) {
      document.body.classList.add("no-hub-btn");
    } else {
      document.body.classList.remove("no-hub-btn");
    }
    return () => document.body.classList.remove("no-hub-btn");
  }, [hidden]);

  if (hidden) return null;

  return (
    <Link
      to="/hub"
      title="Torna all'Hub"
      className="fixed top-2 left-2 z-[200] inline-flex items-center gap-2 px-3 py-2 rounded-sm uppercase tracking-wider font-bold text-sm bg-primary text-primary-foreground border-2 border-ink shadow-[3px_3px_0_0_hsl(var(--ink))] hover:bg-ink hover:text-paper transition-colors"
    >
      <LayoutGrid className="w-4 h-4" />
      <span>Hub</span>
    </Link>
  );
};
