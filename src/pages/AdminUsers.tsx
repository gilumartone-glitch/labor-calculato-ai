import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, UserPlus, ShieldCheck, Save, Check, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RouteGuard } from "@/components/RouteGuard";
import { ALL_SETTORI, AppSettore, SETTORE_LABEL } from "@/lib/produzione/types";

type AppPage = { key: string; label: string; description: string | null; ordine: number };
type Level = "none" | "read" | "write";
type AdminUser = { id: string; email: string; display_name: string | null; approved: boolean; created_at: string; roles: string[] };
type PermRow = { user_id: string; page_key: string; level: Level };
type SettoriRow = { id: string; settori: AppSettore[] | null };

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "coordinatore", label: "Coordinatore" },
  { value: "contabilita", label: "Contabilità" },
  { value: "produzione", label: "Produzione" },
  { value: "commerciale", label: "Commerciale" },
  { value: "magazzino", label: "Magazzino" },
  { value: "member", label: "Member" },
];

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "none", label: "—" },
  { value: "read", label: "Vedi" },
  { value: "write", label: "Modifica" },
];

const Inner = () => {
  const [pages, setPages] = useState<AppPage[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [perms, setPerms] = useState<PermRow[]>([]);
  const [settori, setSettori] = useState<Record<string, AppSettore[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // form nuovo utente
  const [nuEmail, setNuEmail] = useState("");
  const [nuPwd, setNuPwd] = useState("");
  const [nuName, setNuName] = useState("");
  const [nuRoles, setNuRoles] = useState<string[]>([]);
  const [nuPerms, setNuPerms] = useState<Record<string, Level>>({});
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: u, error: uerr }, { data: ps }, { data: settoriData }] = await Promise.all([
      supabase.from("app_pages").select("*").order("ordine"),
      supabase.rpc("admin_list_users"),
      supabase.from("user_permissions").select("user_id, page_key, level"),
      supabase.from("profiles").select("id, settori"),
    ]);
    if (uerr) toast.error(uerr.message);
    setPages((p ?? []) as AppPage[]);
    setUsers((u ?? []) as AdminUser[]);
    setPerms((ps ?? []) as PermRow[]);
    const sm: Record<string, AppSettore[]> = {};
    for (const r of (settoriData ?? []) as SettoriRow[]) sm[r.id] = (r.settori ?? []) as AppSettore[];
    setSettori(sm);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const permFor = (user_id: string, page_key: string): Level => {
    return (perms.find((x) => x.user_id === user_id && x.page_key === page_key)?.level ?? "none") as Level;
  };

  const setPerm = async (user_id: string, page_key: string, level: Level) => {
    const prev = perms;
    setPerms((cur) => {
      const others = cur.filter((x) => !(x.user_id === user_id && x.page_key === page_key));
      return [...others, { user_id, page_key, level }];
    });
    const { error } = await supabase.rpc("admin_set_user_permission", { _user_id: user_id, _page: page_key, _level: level });
    if (error) {
      setPerms(prev);
      toast.error(error.message);
    }
  };

  const toggleRole = async (user: AdminUser, role: string) => {
    const next = user.roles.includes(role) ? user.roles.filter((r) => r !== role) : [...user.roles, role];
    const { error } = await supabase.rpc("admin_set_user_roles", { _user_id: user.id, _roles: next });
    if (error) { toast.error(error.message); return; }
    setUsers((cur) => cur.map((u) => u.id === user.id ? { ...u, roles: next } : u));
  };

  const toggleApproved = async (user: AdminUser) => {
    const { error } = await supabase.from("profiles").update({ approved: !user.approved }).eq("id", user.id);
    if (error) { toast.error(error.message); return; }
    setUsers((cur) => cur.map((u) => u.id === user.id ? { ...u, approved: !user.approved } : u));
  };

  const toggleSettore = async (user_id: string, s: AppSettore) => {
    const cur = settori[user_id] ?? [];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    const prev = settori;
    setSettori((c) => ({ ...c, [user_id]: next }));
    const { error } = await supabase.from("profiles").update({ settori: next }).eq("id", user_id);
    if (error) { setSettori(prev); toast.error(error.message); }
  };

  const createUser = async () => {
    if (!nuEmail || !nuPwd || nuPwd.length < 6) {
      toast.error("Email e password (min 6) obbligatori");
      return;
    }
    setCreating(true);
    try {
      const permissions = Object.entries(nuPerms).filter(([, lvl]) => lvl !== "none").map(([page_key, level]) => ({ page_key, level }));
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: nuEmail,
          password: nuPwd,
          display_name: nuName || undefined,
          approved: true,
          roles: nuRoles,
          permissions,
        },
      });
      if (error || (data as any)?.error) {
        toast.error(((data as any)?.error) || error?.message || "Errore creazione utente");
        return;
      }
      toast.success("Utente creato");
      setShowCreate(false);
      setNuEmail(""); setNuPwd(""); setNuName(""); setNuRoles([]); setNuPerms({});
      await load();
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (user: AdminUser) => {
    const pwd = window.prompt(`Nuova password per ${user.email} (min 6 caratteri):`);
    if (pwd === null) return;
    if (pwd.length < 6) { toast.error("Password troppo corta"); return; }
    const { data, error } = await supabase.functions.invoke("admin-set-password", {
      body: { user_id: user.id, password: pwd },
    });
    if (error || (data as any)?.error) {
      toast.error(((data as any)?.error) || error?.message || "Errore cambio password");
      return;
    }
    toast.success("Password aggiornata");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-ink bg-paper">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold mt-1 inline-flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Gestione utenti</h1>
          </div>
          <button onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-paper rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-primary hover:text-primary-foreground">
            <UserPlus className="w-4 h-4" /> Nuovo utente
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {showCreate && (
          <section className="border-2 border-ink bg-paper p-5 space-y-4">
            <h2 className="font-display text-xl font-semibold">Crea account</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="label-cap block mb-1">Email</label>
                <input className="input-bare w-full text-sm" type="email" value={nuEmail} onChange={(e) => setNuEmail(e.target.value)} />
              </div>
              <div>
                <label className="label-cap block mb-1">Password (min 6)</label>
                <input className="input-bare w-full text-sm" type="text" value={nuPwd} onChange={(e) => setNuPwd(e.target.value)} />
              </div>
              <div>
                <label className="label-cap block mb-1">Nome visualizzato</label>
                <input className="input-bare w-full text-sm" value={nuName} onChange={(e) => setNuName(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="label-cap mb-2">Ruoli</div>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className={`px-3 py-1.5 border-2 rounded-sm text-xs cursor-pointer ${nuRoles.includes(r.value) ? "bg-ink text-paper border-ink" : "border-ink/30 hover:border-ink"}`}>
                    <input type="checkbox" className="hidden" checked={nuRoles.includes(r.value)} onChange={() => setNuRoles((cur) => cur.includes(r.value) ? cur.filter((x) => x !== r.value) : [...cur, r.value])} />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="label-cap mb-2">Permessi sezioni</div>
              <div className="grid gap-2 md:grid-cols-2">
                {pages.map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3 border border-ink/20 rounded-sm px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold">{p.label}</div>
                      {p.description && <div className="text-[11px] text-muted-foreground">{p.description}</div>}
                    </div>
                    <select className="input-bare text-xs" value={nuPerms[p.key] ?? "none"} onChange={(e) => setNuPerms((cur) => ({ ...cur, [p.key]: e.target.value as Level }))}>
                      {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs uppercase tracking-wider border-2 border-ink/30 hover:border-ink rounded-sm">Annulla</button>
              <button disabled={creating} onClick={createUser} className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-paper rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-primary hover:text-primary-foreground disabled:opacity-60">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Crea utente
              </button>
            </div>
          </section>
        )}

        {loading ? (
          <div className="grid place-items-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <section className="border-2 border-ink bg-paper">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink/5 border-b-2 border-ink">
                  <tr>
                    <th className="text-left px-3 py-2 font-display">Utente</th>
                    <th className="text-left px-3 py-2 font-display">Stato</th>
                    <th className="text-left px-3 py-2 font-display">Ruoli</th>
                    <th className="text-left px-3 py-2 font-display">Settori</th>
                    {pages.map((p) => <th key={p.key} className="text-left px-3 py-2 font-display whitespace-nowrap">{p.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-ink/10 hover:bg-ink/5 align-top">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{u.display_name || u.email}</div>
                        <div className="text-[11px] text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => toggleApproved(u)} className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] uppercase tracking-wider border-2 ${u.approved ? "bg-emerald-600 text-white border-emerald-700" : "border-amber-500 text-amber-700 bg-amber-50"}`}>
                            {u.approved ? <><Check className="w-3 h-3" /> Attivo</> : "In attesa"}
                          </button>
                          <button onClick={() => resetPassword(u)} title="Cambia password" className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] uppercase tracking-wider border-2 border-ink/30 hover:border-ink hover:bg-ink hover:text-paper">
                            <KeyRound className="w-3 h-3" /> Password
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {ROLE_OPTIONS.map((r) => (
                            <button key={r.value} onClick={() => toggleRole(u, r.value)} className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider border ${u.roles.includes(r.value) ? "bg-ink text-paper border-ink" : "border-ink/20 hover:border-ink"}`}>
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                          {ALL_SETTORI.map((s) => {
                            const on = (settori[u.id] ?? []).includes(s);
                            return (
                              <button key={s} onClick={() => toggleSettore(u.id, s)} className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider border ${on ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 hover:border-ink"}`}>
                                {SETTORE_LABEL[s]}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      {pages.map((p) => (
                        <td key={p.key} className="px-3 py-2">
                          <select className="input-bare text-xs" value={permFor(u.id, p.key)} onChange={(e) => setPerm(u.id, p.key, e.target.value as Level)}>
                            {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={4 + pages.length} className="px-3 py-6 text-center text-muted-foreground text-sm">Nessun utente</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

const AdminUsers = () => (
  <RouteGuard page="admin" required="write">
    <Inner />
  </RouteGuard>
);

export default AdminUsers;