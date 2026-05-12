import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, LogIn, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const Auth = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Se già loggato, vai all'hub postazioni
  useEffect(() => {
    if (user) navigate("/hub", { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Inserisci email e password");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Accesso effettuato");
      navigate("/hub", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      if (msg.includes("Invalid login")) toast.error("Email o password errati");
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <Link
          to="/hub"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-ink mb-4 font-mono"
        >
          <ArrowLeft className="w-3 h-3" />
          Torna al calcolatore
        </Link>
        <div className="panel p-8 border-2 border-ink bg-paper">
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary mb-2">
              // Officina · Flow
            </div>
            <h1 className="font-display text-3xl font-semibold leading-tight">
              Accedi al tuo flow
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Continua a gestire le commesse del team.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label-cap block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="input-bare w-full text-sm"
              />
            </div>
            <div>
              <label className="label-cap block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
                className="input-bare w-full text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-ink text-paper rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Accedi
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-ink/15 text-center">
            <p className="text-[11px] text-muted-foreground">
              La registrazione è gestita dall'amministratore. Contatta il responsabile per ricevere un account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;