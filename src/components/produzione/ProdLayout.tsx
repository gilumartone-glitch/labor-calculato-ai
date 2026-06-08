import { ReactNode, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Workflow, Package, MessagesSquare, Truck, FileText,
  ScrollText, ArrowLeft, LogOut, Bell, Wand2, PackageCheck, Menu, CalendarClock,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "./NotificationsBell";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";

const NAV = [
  { to: "/produzione", end: true, label: "Dashboard", Icon: LayoutDashboard },
  { to: "/produzione/board", label: "Flow Board", Icon: Workflow },
  { to: "/produzione/magazzino", label: "Magazzino", Icon: Package },
  { to: "/produzione/trova-materiale", label: "Trova materiale", Icon: Wand2 },
  { to: "/produzione/chat", label: "Chat", Icon: MessagesSquare },
  { to: "/produzione/preparazione", label: "Preparazione", Icon: PackageCheck },
  { to: "/produzione/logistica", label: "Logistica", Icon: Truck },
  { to: "/produzione/amministrazione", label: "Amministrazione", Icon: FileText },
  { to: "/produzione/log", label: "Log Attività", Icon: ScrollText },
];

export const ProdLayout = ({ children }: { children: ReactNode }) => {
  const { user, signOut } = useAuth();
  const loadAll = useProdStore((s) => s.loadAll);
  const refreshNotifications = useProdStore((s) => s.refreshNotifications);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadAll();
    refreshNotifications(user.id);
    const ch = supabase
      .channel("prod-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "production_orders" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "production_sub_orders" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_items" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_scrap_pieces" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "prod_notifications", filter: `user_id=eq.${user.id}` }, () => refreshNotifications(user.id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadAll, refreshNotifications]);

  const SidebarInner = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
        <div className="px-4 py-4 border-b-2 border-ink/15">
          <div className="font-display text-lg font-semibold leading-none mt-2">
            Produzione <span className="text-primary">·</span>
          </div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mt-1">
            Flow Manager
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-sm text-[12px] font-medium transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" : "text-ink/70 hover:bg-muted hover:text-ink"
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t-2 border-ink/15 flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] text-ink/60 truncate">{user?.email}</div>
          <button
            onClick={() => signOut()}
            className="p-1.5 border border-ink/30 rounded-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
            title="Esci"
          >
            <LogOut className="w-3 h-3" />
          </button>
        </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:flex w-56 shrink-0 border-r-2 border-ink/15 bg-paper flex-col">
        <SidebarInner />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b-2 border-ink/15 bg-paper flex items-center justify-between md:justify-end px-3 md:px-4 gap-3">
          <div className="md:hidden flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  className="p-2 border border-ink/30 rounded-sm hover:bg-muted"
                  aria-label="Apri menu"
                >
                  <Menu className="w-4 h-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 flex flex-col bg-paper">
                <SidebarInner onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="font-display text-sm font-semibold">Flow Manager</div>
          </div>
          <NotificationsBell />
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
};