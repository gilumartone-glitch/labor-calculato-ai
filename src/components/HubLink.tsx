import { Link } from "react-router-dom";
import { LayoutGrid } from "lucide-react";

type Variant = "ink" | "outline" | "compact";

export const HubLink = ({ variant = "ink", className = "" }: { variant?: Variant; className?: string }) => {
  const base = "inline-flex items-center gap-2 rounded-sm uppercase tracking-wider font-bold transition-colors";
  const styles: Record<Variant, string> = {
    ink: "px-3 py-2 border-2 border-ink bg-background text-ink text-base hover:bg-ink hover:text-paper",
    outline: "px-3 py-2 border-2 border-input bg-background text-foreground text-base hover:bg-accent hover:text-accent-foreground",
    compact: "px-2.5 py-1.5 border-2 border-ink/40 bg-paper text-ink text-sm hover:bg-ink hover:text-paper",
  };

  return (
    <Link to="/hub" title="Torna all'Hub" className={`${base} ${styles[variant]} ${className}`}>
      <LayoutGrid className="w-4 h-4" />
      <span>Hub</span>
    </Link>
  );
};
