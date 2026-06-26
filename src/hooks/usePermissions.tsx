import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PageKey = "preventivi" | "flow" | "contabilita" | "falegnameria" | "montaggi" | "produzione" | "dipendenti" | "admin";
export type Level = "none" | "read" | "write";

type State = {
  loading: boolean;
  isAdmin: boolean;
  approved: boolean;
  roles: string[];
  perms: Record<string, Level>;
  settori: string[];
};

export const usePermissions = () => {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ loading: true, isAdmin: false, approved: false, roles: [], perms: {}, settori: [] });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ loading: false, isAdmin: false, approved: false, roles: [], perms: {}, settori: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: roles }, { data: perms }, { data: profile }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("user_permissions").select("page_key, level").eq("user_id", user.id),
        supabase.from("profiles").select("approved, settori").eq("id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const roleList = (roles ?? []).map((r: any) => r.role as string);
      const isAdmin = roleList.includes("admin");
      const map: Record<string, Level> = {};
      (perms ?? []).forEach((p: any) => { map[p.page_key] = p.level as Level; });
      const settori = (((profile as any)?.settori ?? []) as string[]) || [];
      setState({ loading: false, isAdmin, approved: !!profile?.approved, roles: roleList, perms: map, settori });
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  const can = (page: PageKey, required: Level = "read") => {
    if (state.isAdmin) return true;
    const lvl = state.perms[page] ?? "none";
    if (required === "read") return lvl === "read" || lvl === "write";
    if (required === "write") return lvl === "write";
    return true;
  };

  const isAmministrazione = state.isAdmin || (state.settori ?? []).includes("amministrazione");

  return { ...state, can, isAmministrazione };
};
