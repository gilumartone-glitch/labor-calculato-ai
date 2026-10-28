import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) { toast.error("Almeno 8 caratteri"); return; }
    if (pwd !== pwd2) { toast.error("Le password non coincidono"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password aggiornata");
    navigate("/hub", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4">
      <form onSubmit={submit} className="panel p-8 border-2 border-ink bg-paper w-full max-w-md space-y-4">
        <h1 className="font-display text-3xl font-semibold">Nuova password</h1>
        <div>
          <label className="block mb-1 text-base">Nuova password</label>
          <input type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="input-bare w-full text-base" />
        </div>
        <div>
          <label className="block mb-1 text-base">Conferma password</label>
          <input type="password" autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className="input-bare w-full text-base" />
        </div>
        <button type="submit" disabled={saving} className="w-full px-4 py-3 bg-ink text-paper rounded-sm text-base font-bold disabled:opacity-60">
          Salva password
        </button>
      </form>
    </div>
  );
};

export default ResetPassword;
