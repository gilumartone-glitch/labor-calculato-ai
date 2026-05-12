import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

type Variant = "ink" | "outline" | "compact";

export const AdminUsersLink = ({ variant = "ink", className = "" }: { variant?: Variant; className?: string }) => {
  const { isAdmin } = usePermissions();
  if (!isAdmin) return null;

  const base = "inline-flex items-center gap-1.5 rounded-sm uppercase tracking-wider font-semibold transition-colors";
  const styles: Record<Variant, string> = {
    ink: "px-2.5 py-2 border-2 border-ink bg-background text-ink/70 text-[11px] hover:bg-ink hover:text-paper",
    outline: "px-3 py-2 border border-input bg-background text-foreground text-xs hover:bg-accent hover:text-accent-foreground",
    compact: "px-2 py-1 border border-ink/30 bg-paper text-ink/80 text-[10px] hover:bg-ink hover:text-paper",
  };

  return (
    <Link to="/admin/utenti" title="Gestione utenti e permessi" className={`${base} ${styles[variant]} ${className}`}>
      <ShieldCheck className="w-3.5 h-3.5" />
      <span className="hidden md:inline">Utenti</span>
    </Link>
  );
};