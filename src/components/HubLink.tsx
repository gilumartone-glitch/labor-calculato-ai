import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, LayoutGrid } from "lucide-react";

type Variant = "ink" | "outline" | "compact";

// Retro-compatibilità: il pulsante è ora globale e fisso.
export const HubLink = (_props: { variant?: Variant; className?: string } = {}) => null;

const btnCls =
  "inline-flex items-center justify-center w-14 h-14 md:w-10 md:h-10 rounded-full bg-primary text-primary-foreground border-2 border-ink shadow-[3px_3px_0_0_hsl(var(--ink))] active:translate-y-px hover:bg-ink hover:text-paper transition-colors touch-manipulation";

export const FloatingHubButton = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const hideOn = ["/hub", "/auth", "/"];
  const hidden = hideOn.includes(location.pathname);

  useEffect(() => {
    if (hidden) document.body.classList.add("no-hub-btn");
    else document.body.classList.remove("no-hub-btn");
    return () => document.body.classList.remove("no-hub-btn");
  }, [hidden]);

  if (hidden) return null;

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/hub");
  };

  return (
    <div
      className="fixed z-[300] flex items-center gap-2"
      style={{
        bottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
        left: "max(env(safe-area-inset-left, 0px), 12px)",
      }}
    >
      <button type="button" onClick={goBack} title="Torna indietro" aria-label="Torna alla pagina precedente" className={btnCls}>
        <ArrowLeft className="w-6 h-6 md:w-5 md:h-5" />
      </button>
      <Link to="/hub" title="Torna all'Hub" aria-label="Torna all'Hub" className={btnCls}>
        <LayoutGrid className="w-6 h-6 md:w-4 md:h-4" />
      </Link>
    </div>
  );
};
