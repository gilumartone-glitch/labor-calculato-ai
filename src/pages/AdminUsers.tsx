import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldCheck, Save, Check, KeyRound, Trash2, Search, ChevronDown, ChevronUp, Mail, User as UserIcon, X } from "lucide-react";
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

const LEVEL_OPTIONS: { value: Level; label: string; cls: string }[] = [
  { value: "none",  label: "Nessuno", cls: "bg-muted text-muted-foreground border-transparent" },
  { value: "read",  label: "Vedi",    cls: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-900/30 dark:text-blue-100" },
  { value: "write", label: "Modifica", cls: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-100" },
];

const levelCls = (l: Level) => LEVEL_OPTIONS.find(o => o.value === l)?.cls ?? LEVEL_OPTIONS[0].cls;

const Inner = () => {
  const [pages, setPages] = useState<AppPage[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [perms, setPerms] = useState<PermRow[]>([]);
  const [settori, setSettori] = useState<Record<string, AppSettore[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const permFor = (user_id: string, page_key: string): Level =>
    (perms.find((x) => x.user_id === user_id && x.page_key === page_key)?.level ?? "none") as Level;

  const setPerm = async (user_id: string, page_key: string, level: Level) => {
    const prev = perms;
    setPerms((cur) => {
      const others = cur.filter((x) => !(x.user_id === user_id && x.page_key === page_key));
      return [...others, { user_id, page_key, level }];
    });
    const { error } = await supabase.rpc("admin_set_user_permission", { _user_id: user_id, _page: page_key, _level: level });
    if (error) { setPerms(prev); toast.error(error.message); }
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
    if (!nuEmail || !nuPwd || nuPwd.length < 8) { toast.error("Email e password (min 8 caratteri) obbligatori"); return; }
    setCreating(true);
    try {
      const permissions = Object.entries(nuPerms).filter(([, lvl]) => lvl !== "none").map(([page_key, level]) => ({ page_key, level }));
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { email: nuEmail, password: nuPwd, display_name: nuName || undefined, approved: true, roles: nuRoles, permissions },
      });
      if (error || (data as any)?.error) { toast.error(((data as any)?.error) || error?.message || "Errore creazione utente"); return; }
      toast.success("Utente creato");
      setShowCreate(false);
      setNuEmail(""); setNuPwd(""); setNuName(""); setNuRoles([]); setNuPerms({});
      await load();
    } finally { setCreating(false); }
  };

  const resetPassword = async (user: AdminUser) => {
    const pwd = window.prompt(`Nuova password per ${user.email} (min 8 caratteri):`);
    if (pwd === null) return;
    if (pwd.length < 8) { toast.error("Password troppo corta (min 8)"); return; }
    const { data, error } = await supabase.functions.invoke("admin-set-password", { body: { user_id: user.id, password: pwd } });
    if (error || (data as any)?.error) { toast.error(((data as any)?.error) || error?.message); return; }
    toast.success("Password aggiornata");
  };

  const deleteUser = async (user: AdminUser) => {
    if (!window.confirm(`Eliminare definitivamente ${user.display_name || user.email}?\nQuesta azione non è reversibile.`)) return;
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { user_id: user.id } });
    if (error || (data as any)?.error) { toast.error(((data as any)?.error) || error?.message); return; }
    toast.success("Utente eliminato");
    setUsers((cur) => cur.filter((u) => u.id !== user.id));
  };

  const updateUser = async (user: AdminUser, patch: { email?: string; display_name?: string }) => {
    const { data, error } = await supabase.functions.invoke("admin-update-user", { body: { user_id: user.id, ...patch } });
    if (error || (data as any)?.error) { toast.error(((data as any)?.error) || error?.message); return; }
    toast.success("Utente aggiornato");
    setUsers((cur) => cur.map((x) => x.id === user.id ? { ...x, ...patch } : x));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.display_name ?? "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.roles.some((r) => r.toLowerCase().includes(q))
    );
  }, [users, query]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-ink bg-paper sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold inline-flex items-center gap-3">
              <ShieldCheck className="w-7 h-7" /> Gestione utenti
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{users.length} utenti totali · {users.filter(u => u.approved).length} attivi</p>
          </div>
          <button onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 px-5 py-3 bg-ink text-paper rounded-sm text-sm uppercase tracking-wider font-bold hover:bg-primary hover:text-primary-foreground">
            <UserPlus className="w-5 h-5" /> Nuovo utente
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {showCreate && (
          <section className="border-2 border-ink bg-paper p-6 space-y-5 rounded-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">Crea account</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-muted rounded-sm"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs uppercase tracking-wider font-bold block mb-1.5">Email</label>
                <input className="w-full text-sm border-2 border-ink/20 focus:border-ink rounded-sm px-3 py-2 bg-background" type="email" value={nuEmail} onChange={(e) => setNuEmail(e.target.value)} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider font-bold block mb-1.5">Password (min 8)</label>
                <input className="w-full text-sm border-2 border-ink/20 focus:border-ink rounded-sm px-3 py-2 bg-background" type="text" value={nuPwd} onChange={(e) => setNuPwd(e.target.value)} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider font-bold block mb-1.5">Nome</label>
                <input className="w-full text-sm border-2 border-ink/20 focus:border-ink rounded-sm px-3 py-2 bg-background" value={nuName} onChange={(e) => setNuName(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-bold mb-2">Ruoli</div>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className={`px-3 py-2 border-2 rounded-sm text-sm cursor-pointer transition-colors ${nuRoles.includes(r.value) ? "bg-ink text-paper border-ink" : "border-ink/30 hover:border-ink"}`}>
                    <input type="checkbox" className="hidden" checked={nuRoles.includes(r.value)} onChange={() => setNuRoles((cur) => cur.includes(r.value) ? cur.filter((x) => x !== r.value) : [...cur, r.value])} />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-bold mb-2">Permessi sezioni</div>
              <div className="grid gap-2 md:grid-cols-2">
                {pages.map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3 border-2 border-ink/15 rounded-sm px-3 py-2.5 hover:border-ink/40">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{p.label}</div>
                      {p.description && <div className="text-xs text-muted-foreground truncate">{p.description}</div>}
                    </div>
                    <div className="flex gap-1">
                      {LEVEL_OPTIONS.map((o) => (
                        <button key={o.value} type="button" onClick={() => setNuPerms((cur) => ({ ...cur, [p.key]: o.value }))}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-sm border-2 ${(nuPerms[p.key] ?? "none") === o.value ? o.cls : "border-ink/20 text-muted-foreground bg-transparent"}`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-ink/10">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-sm uppercase tracking-wider border-2 border-ink/30 hover:border-ink rounded-sm">Annulla</button>
              <button disabled={creating} onClick={createUser} className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-paper rounded-sm text-sm uppercase tracking-wider font-bold hover:bg-primary hover:text-primary-foreground disabled:opacity-60">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Crea utente
              </button>
            </div>
          </section>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            className="w-full pl-11 pr-4 py-3 border-2 border-ink/20 focus:border-ink rounded-sm bg-paper text-base"
            placeholder="Cerca per nome, email o ruolo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="grid place-items-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((u) => {
              const isOpen = !!expanded[u.id];
              const activePerms = pages.filter((p) => permFor(u.id, p.key) !== "none");
              return (
                <article key={u.id} className={`border-2 rounded-sm bg-paper transition-all ${u.approved ? "border-ink/30" : "border-amber-400"}`}>
                  {/* Header */}
                  <header className="p-4 flex flex-wrap items-start gap-4">
                    <div className="w-11 h-11 rounded-full bg-ink text-paper grid place-items-center font-display text-lg font-bold flex-shrink-0">
                      {(u.display_name?.[0] || u.email[0] || "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          className="text-lg font-display font-semibold bg-transparent border-b-2 border-transparent hover:border-ink/20 focus:border-ink outline-none px-1 flex-1 min-w-[180px]"
                          defaultValue={u.display_name ?? ""}
                          placeholder="Nome"
                          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (u.display_name ?? "")) updateUser(u, { display_name: v }); }}
                        />
                        <button
                          onClick={() => toggleApproved(u)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs uppercase tracking-wider font-bold border-2 ${u.approved ? "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700" : "bg-amber-50 border-amber-500 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100"}`}
                        >
                          {u.approved ? <><Check className="w-3.5 h-3.5" /> Attivo</> : "In attesa"}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4 flex-shrink-0" />
                        <input
                          className="bg-transparent border-b-2 border-transparent hover:border-ink/20 focus:border-ink outline-none flex-1 min-w-[200px]"
                          defaultValue={u.email}
                          type="email"
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.email) updateUser(u, { email: v }); else e.target.value = u.email; }}
                        />
                      </div>
                      {/* Roles chips */}
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {u.roles.length === 0 && <span className="text-xs text-muted-foreground italic">Nessun ruolo</span>}
                        {u.roles.map((r) => {
                          const opt = ROLE_OPTIONS.find(o => o.value === r);
                          return <span key={r} className="px-2 py-1 rounded-sm text-xs font-semibold bg-ink text-paper">{opt?.label ?? r}</span>;
                        })}
                        <span className="text-xs text-muted-foreground ml-2">
                          {activePerms.length}/{pages.length} sezioni · {(settori[u.id] ?? []).length} settori
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => setExpanded((c) => ({ ...c, [u.id]: !c[u.id] }))} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold border-2 border-ink/40 hover:bg-ink hover:text-paper">
                        {isOpen ? <><ChevronUp className="w-4 h-4" /> Chiudi</> : <><ChevronDown className="w-4 h-4" /> Gestisci</>}
                      </button>
                    </div>
                  </header>

                  {isOpen && (
                    <div className="border-t-2 border-ink/10 p-5 space-y-5 bg-muted/30">
                      {/* Ruoli */}
                      <section>
                        <h3 className="text-sm uppercase tracking-wider font-bold mb-2 flex items-center gap-2"><UserIcon className="w-4 h-4" /> Ruoli</h3>
                        <div className="flex flex-wrap gap-2">
                          {ROLE_OPTIONS.map((r) => {
                            const on = u.roles.includes(r.value);
                            return (
                              <button key={r.value} onClick={() => toggleRole(u, r.value)} className={`px-3 py-1.5 rounded-sm text-sm font-semibold border-2 transition-colors ${on ? "bg-ink text-paper border-ink" : "border-ink/25 hover:border-ink bg-paper"}`}>
                                {r.label}
                              </button>
                            );
                          })}
                        </div>
                      </section>

                      {/* Settori */}
                      <section>
                        <h3 className="text-sm uppercase tracking-wider font-bold mb-2">Settori operativi</h3>
                        <div className="flex flex-wrap gap-2">
                          {ALL_SETTORI.map((s) => {
                            const on = (settori[u.id] ?? []).includes(s);
                            return (
                              <button key={s} onClick={() => toggleSettore(u.id, s)} className={`px-3 py-1.5 rounded-sm text-sm font-semibold border-2 transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "border-ink/25 hover:border-ink bg-paper"}`}>
                                {SETTORE_LABEL[s]}
                              </button>
                            );
                          })}
                        </div>
                      </section>

                      {/* Permessi */}
                      <section>
                        <h3 className="text-sm uppercase tracking-wider font-bold mb-2">Permessi sezioni</h3>
                        <div className="grid gap-2 md:grid-cols-2">
                          {pages.map((p) => {
                            const lvl = permFor(u.id, p.key);
                            return (
                              <div key={p.key} className="flex items-center justify-between gap-3 border-2 border-ink/15 rounded-sm px-3 py-2.5 bg-paper">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold">{p.label}</div>
                                  {p.description && <div className="text-xs text-muted-foreground truncate">{p.description}</div>}
                                </div>
                                <div className="flex gap-1 flex-shrink-0">
                                  {LEVEL_OPTIONS.map((o) => (
                                    <button
                                      key={o.value}
                                      onClick={() => setPerm(u.id, p.key, o.value)}
                                      className={`px-2.5 py-1.5 text-xs font-bold rounded-sm border-2 ${lvl === o.value ? o.cls : "border-ink/15 text-muted-foreground hover:border-ink/40"}`}
                                    >
                                      {o.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>

                      {/* Azioni */}
                      <section className="flex flex-wrap gap-2 pt-3 border-t border-ink/10">
                        <button onClick={() => resetPassword(u)} className="inline-flex items-center gap-2 px-3 py-2 rounded-sm text-sm uppercase tracking-wider font-bold border-2 border-ink/30 hover:bg-ink hover:text-paper">
                          <KeyRound className="w-4 h-4" /> Cambia password
                        </button>
                        <button onClick={() => deleteUser(u)} className="inline-flex items-center gap-2 px-3 py-2 rounded-sm text-sm uppercase tracking-wider font-bold border-2 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground">
                          <Trash2 className="w-4 h-4" /> Elimina utente
                        </button>
                      </section>
                    </div>
                  )}
                </article>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-ink/20 rounded-sm">Nessun utente trovato</div>
            )}
          </div>
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
