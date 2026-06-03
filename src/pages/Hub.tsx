import { Link, Navigate } from "react-router-dom";
import { Calculator, Workflow, Landmark, LogOut, Loader2, ShieldCheck, Factory, Package, Megaphone, HardHat } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions, PageKey } from "@/hooks/usePermissions";
import { AdminUsersLink } from "@/components/AdminUsersLink";
import { ChangePasswordButton } from "@/components/ChangePasswordButton";
import { UpdateCheckButton } from "@/components/UpdateCheckButton";
import { ThemeToggle } from "@/components/ThemeToggle";

type Tile = {
  key: PageKey;
  label: string;
  description: string;
  to: string;
  Icon: typeof Calculator;
  color: string;
  iconBg: string;
};

const TILES: Tile[] = [
  { key: "preventivi",  label: "Progettazione", description: "Schede progetto multiple: calcolo, listini, materiali", to: "/preventivi", Icon: Calculator, color: "bg-[hsl(184_85%_32%)] text-white border-[hsl(184_85%_22%)]", iconBg: "bg-[hsl(184_85%_22%)]" },
  { key: "flow",        label: "Flow",          description: "Panoramica di tutti i progetti: stato, scadenze, importi",   to: "/flow",       Icon: Workflow,   color: "bg-[hsl(225_58%_42%)] text-white border-[hsl(225_58%_28%)]", iconBg: "bg-[hsl(225_58%_28%)]" },
  { key: "produzione",  label: "Produzione",    description: "Officina: sub-ordini per reparto, materiali, magazzino, bolle", to: "/produzione", Icon: Factory,    color: "bg-[hsl(28_86%_46%)] text-white border-[hsl(28_86%_32%)]",   iconBg: "bg-[hsl(28_86%_32%)]" },
  { key: "contabilita", label: "Contabilità",   description: "Cassa, competenza e movimenti",                              to: "/contabilita", Icon: Landmark,   color: "bg-[hsl(145_42%_34%)] text-white border-[hsl(145_42%_22%)]", iconBg: "bg-[hsl(145_42%_22%)]" },
];

const Hub = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { loading, isAdmin, approved, can } = usePermissions();

  if (authLoading || loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin && !approved) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center border-2 border-ink bg-paper p-8 rounded-sm">
          <h1 className="font-display text-2xl font-semibold mb-2">Account in attesa di approvazione</h1>
          <p className="text-sm text-muted-foreground">Un amministratore deve abilitare il tuo account prima che tu possa accedere alle sezioni.</p>
          <button onClick={signOut} className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-ink">
            <LogOut className="w-3 h-3" /> Esci
          </button>
        </div>
      </div>
    );
  }

  const visible = TILES.filter((t) => can(t.key, "read"));
  const showMagazzino = isAdmin || approved;
  

  return (
    <div className="min-h-screen bg-background">
      <header className="app-header border-b-2 border-ink bg-paper">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary mb-1">// Officina · Tecnofra</div>
            <h1 className="font-display text-2xl font-semibold leading-none">Hub</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <UpdateCheckButton />
            <ChangePasswordButton variant="outline" />
            <AdminUsersLink variant="outline" />
            <button onClick={signOut} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider border-2 border-ink/30 hover:border-ink rounded-sm">
              <LogOut className="w-3 h-3" /> Esci
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-10">
        {visible.length === 0 ? (
          <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm">
            <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <h2 className="font-display text-xl font-semibold mb-1">Nessuna sezione abilitata</h2>
            <p className="text-sm text-muted-foreground">Chiedi a un amministratore di assegnarti i permessi.</p>
          </div>
        ) : (
          <div className={`grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`}>
            {visible.map(({ key, label, description, to, Icon, color, iconBg }) => (
              <Link
                key={key}
                to={to}
                className={`group relative border-2 ${color} p-7 rounded-sm shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all`}
              >
                <div className="flex items-start justify-between mb-5">
                  <div className={`w-14 h-14 rounded-sm ${iconBg} text-white grid place-items-center`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-white/70">{key}</span>
                </div>
                <h3 className="font-display text-2xl font-semibold leading-tight mb-1">{label}</h3>
                <p className="text-sm text-white/80">{description}</p>
                <span className="absolute bottom-4 right-5 font-mono text-[11px] uppercase tracking-widest text-white/60 group-hover:text-white">Apri →</span>
              </Link>
            ))}
            {showMagazzino && (
              <Link
                to="/magazzino"
                className="group relative border-2 bg-[hsl(260_45%_42%)] text-white border-[hsl(260_45%_28%)] p-7 rounded-sm shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="w-14 h-14 rounded-sm bg-[hsl(260_45%_28%)] text-white grid place-items-center">
                    <Package className="w-7 h-7" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-white/70">magazzino</span>
                </div>
                <h3 className="font-display text-2xl font-semibold leading-tight mb-1">Magazzino</h3>
                <p className="text-sm text-white/80">Scorte di Laboratorio e Tappezzeria, sotto-soglia e sfridi</p>
                <span className="absolute bottom-4 right-5 font-mono text-[11px] uppercase tracking-widest text-white/60 group-hover:text-white">Apri →</span>
              </Link>
            )}
            {can("montaggi", "read") && (
              <Link
                to="/montaggi-pianificazione"
                className="group relative border-2 bg-[hsl(35_80%_42%)] text-white border-[hsl(35_80%_28%)] p-7 rounded-sm shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="w-14 h-14 rounded-sm bg-[hsl(35_80%_28%)] text-white grid place-items-center">
                    <HardHat className="w-7 h-7" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-white/70">montaggi</span>
                </div>
                <h3 className="font-display text-2xl font-semibold leading-tight mb-1">Montaggi</h3>
                <p className="text-sm text-white/80">Panoramica cantieri, operai e calendario settimanale</p>
                <span className="absolute bottom-4 right-5 font-mono text-[11px] uppercase tracking-widest text-white/60 group-hover:text-white">Apri →</span>
              </Link>
            )}
            {(isAdmin || approved) && (
              <Link
                to="/marketing"
                className="group relative border-2 bg-[hsl(340_72%_44%)] text-white border-[hsl(340_72%_30%)] p-7 rounded-sm shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="w-14 h-14 rounded-sm bg-[hsl(340_72%_30%)] text-white grid place-items-center">
                    <Megaphone className="w-7 h-7" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-white/70">marketing</span>
                </div>
                <h3 className="font-display text-2xl font-semibold leading-tight mb-1">Marketing</h3>
                <p className="text-sm text-white/80">Newsletter Mailchimp e rubrica contatti per categoria</p>
                <span className="absolute bottom-4 right-5 font-mono text-[11px] uppercase tracking-widest text-white/60 group-hover:text-white">Apri →</span>
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Hub;
