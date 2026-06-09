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
      aria-label="Torna all'Hub"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
        left: "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
      }}
      className="fixed z-[300] inline-flex items-center justify-center w-12 h-12 md:w-10 md:h-10 rounded-full bg-primary text-primary-foreground border-2 border-ink shadow-[3px_3px_0_0_hsl(var(--ink))] active:translate-y-px hover:bg-ink hover:text-paper transition-colors touch-manipulation"
    >
      <LayoutGrid className="w-5 h-5 md:w-4 md:h-4" />
    </Link>
  );
};
