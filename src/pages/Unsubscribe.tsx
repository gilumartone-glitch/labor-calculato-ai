import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type State = "loading" | "valid" | "invalid" | "done" | "already" | "error";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    (async () => {
      try {
        const res = await fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
          headers: { apikey: ANON },
        });
        const data = await res.json();
        if (data.valid) setState("valid");
        else if (data.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch { setState("error"); }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setState("loading");
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    if (error) setState("error");
    else if (data?.success) setState("done");
    else if (data?.reason === "already_unsubscribed") setState("already");
    else setState("error");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">Annulla iscrizione</h1>
        {state === "loading" && <p className="text-muted-foreground">Verifica in corso…</p>}
        {state === "valid" && (
          <>
            <p className="text-muted-foreground mb-6">Conferma per non ricevere più email da Tecnofra Lab.</p>
            <Button onClick={confirm} className="w-full">Conferma annullamento</Button>
          </>
        )}
        {state === "done" && <p className="text-muted-foreground">Iscrizione annullata. Non riceverai più email.</p>}
        {state === "already" && <p className="text-muted-foreground">Eri già disiscritto.</p>}
        {state === "invalid" && <p className="text-muted-foreground">Link non valido o scaduto.</p>}
        {state === "error" && <p className="text-destructive">Errore. Riprova più tardi.</p>}
      </div>
    </div>
  );
}
