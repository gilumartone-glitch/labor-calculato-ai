import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { ProdOrder, ProdSubOrder, InvItem, ProdNotification, ScrapPiece } from "./types";
import { Profile } from "@/components/flow/types";

type State = {
  loaded: boolean;
  orders: ProdOrder[];
  subs: ProdSubOrder[];
  inventory: InvItem[];
  scraps: ScrapPiece[];
  notifications: ProdNotification[];
  profiles: Profile[];
  loadAll: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshScraps: () => Promise<void>;
  refreshNotifications: (userId: string) => Promise<void>;
  setOrders: (o: ProdOrder[]) => void;
  setSubs: (s: ProdSubOrder[]) => void;
};

/** One reload at a time; calls made meanwhile wait for one shared follow-up reload. */
const singleFlight = (fn: () => Promise<void>) => {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = () => { running = fn().finally(() => { running = null; }); return running; };
  return (): Promise<void> => {
    if (!running) return start();
    if (!queued) queued = running.catch(() => undefined).then(() => { queued = null; return start(); });
    return queued;
  };
};

export const useProdStore = create<State>((set) => {
  const loadAll = singleFlight(async () => {
    const [{ data: orders }, { data: subs }, { data: inv }, { data: scraps }, { data: profiles }] = await Promise.all([
      supabase.from("production_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("production_sub_orders").select("*").order("ordine", { ascending: true }),
      supabase.from("inventory_items").select("*").order("code", { ascending: true }),
      supabase.from("inventory_scrap_pieces").select("*").order("code", { ascending: true }),
      supabase.from("profiles").select("id, display_name, avatar_url, settori"),
    ]);
    set({
      loaded: true,
      orders: (orders ?? []) as any,
      subs: (subs ?? []) as any,
      inventory: (inv ?? []) as any,
      scraps: (scraps ?? []) as any,
      profiles: (profiles ?? []) as any,
    });
  });

  const refreshOrders = singleFlight(async () => {
    const [{ data: orders }, { data: subs }] = await Promise.all([
      supabase.from("production_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("production_sub_orders").select("*").order("ordine", { ascending: true }),
    ]);
    set({ orders: (orders ?? []) as any, subs: (subs ?? []) as any });
  });

  const refreshInventory = singleFlight(async () => {
    const [{ data }, { data: scraps }] = await Promise.all([
      supabase.from("inventory_items").select("*").order("code", { ascending: true }),
      supabase.from("inventory_scrap_pieces").select("*").order("code", { ascending: true }),
    ]);
    set({ inventory: (data ?? []) as any, scraps: (scraps ?? []) as any });
  });

  return {
    loaded: false,
    orders: [],
    subs: [],
    inventory: [],
    scraps: [],
    notifications: [],
    profiles: [],
    loadAll,
    refreshOrders,
    refreshInventory,

    refreshScraps: async () => {
      const { data } = await supabase.from("inventory_scrap_pieces").select("*").order("code", { ascending: true });
      set({ scraps: (data ?? []) as any });
    },

    refreshNotifications: async (userId: string) => {
      const { data } = await supabase
        .from("prod_notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      set({ notifications: (data ?? []) as any });
    },

    setOrders: (orders) => set({ orders }),
    setSubs: (subs) => set({ subs }),
  };
});
