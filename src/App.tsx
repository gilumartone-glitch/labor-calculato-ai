import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { loadRepartiConfig } from "@/lib/reparti";
loadRepartiConfig();

import { RouteGuard } from "@/components/RouteGuard";
import { FloatingHubButton } from "@/components/HubLink";
import Index from "./pages/Index";

const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Auth = lazy(() => import("./pages/Auth.tsx"));
const Flow = lazy(() => import("./pages/Flow.tsx"));
const Falegnameria = lazy(() => import("./pages/Falegnameria.tsx"));
const Montaggi = lazy(() => import("./pages/Montaggi.tsx"));
const MontaggiPianificazione = lazy(() => import("./pages/MontaggiPianificazione.tsx"));
const Contabilita = lazy(() => import("./pages/Contabilita.tsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.tsx"));
const Hub = lazy(() => import("./pages/Hub.tsx"));
const MagazzinoView = lazy(() => import("./pages/MagazzinoView.tsx"));
const Marketing = lazy(() => import("./pages/Marketing.tsx"));
const Record = lazy(() => import("./pages/Record.tsx"));
const Dipendenti = lazy(() => import("./pages/Dipendenti.tsx"));
const ProdDashboard = lazy(() => import("./pages/produzione/ProdDashboard.tsx"));
const ProdBoard = lazy(() => import("./pages/produzione/ProdBoard.tsx"));
const ProdOggi = lazy(() => import("./pages/produzione/ProdOggi.tsx"));
const ProdInventory = lazy(() => import("./pages/produzione/ProdInventory.tsx"));
const ProdFindMaterial = lazy(() => import("./pages/produzione/ProdFindMaterial.tsx"));
const ProdChat = lazy(() => import("./pages/produzione/ProdChat.tsx"));
const ProdLogistica = lazy(() => import("./pages/produzione/ProdLogistica.tsx"));
const ProdAmministrazione = lazy(() => import("./pages/produzione/ProdAmministrazione.tsx"));
const ProdPreparazione = lazy(() => import("./pages/produzione/ProdPreparazione.tsx"));
const ProdAcquisti = lazy(() => import("./pages/produzione/ProdAcquisti.tsx"));
const ProdLog = lazy(() => import("./pages/produzione/ProdLog.tsx"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe.tsx"));

const queryClient = new QueryClient();

// Usa HashRouter quando l'app gira sotto file:// (Electron desktop),
// BrowserRouter quando gira in un browser normale.
const Router =
  typeof window !== "undefined" && window.location.protocol === "file:"
    ? HashRouter
    : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Router>
        <AuthProvider>
          <FloatingHubButton />
          <Suspense fallback={<div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">Caricamento…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/hub" replace />} />
            <Route path="/preventivi" element={<RouteGuard page="preventivi"><Index /></RouteGuard>} />
            <Route path="/vendite" element={<Navigate to="/preventivi?tab=magazzino" replace />} />
            <Route path="/tappeti-danza" element={<Navigate to="/preventivi?tab=magazzino&sub=danza" replace />} />
            <Route path="/vernici-ignifughe" element={<Navigate to="/preventivi?tab=magazzino&sub=ignifugo" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/hub" element={<Hub />} />
            <Route path="/magazzino" element={<MagazzinoView />} />
            <Route path="/marketing" element={<Marketing />} />
            <Route path="/record" element={<Record />} />
            <Route path="/dipendenti" element={<RouteGuard page="dipendenti"><Dipendenti /></RouteGuard>} />
            <Route path="/flow" element={<RouteGuard page="flow"><Flow /></RouteGuard>} />
            <Route path="/falegnameria" element={<RouteGuard page="falegnameria"><Falegnameria /></RouteGuard>} />
            <Route path="/montaggi" element={<RouteGuard page="montaggi"><Montaggi /></RouteGuard>} />
            <Route path="/montaggi-pianificazione" element={<RouteGuard page="montaggi"><MontaggiPianificazione /></RouteGuard>} />
            <Route path="/contabilita" element={<RouteGuard page="contabilita"><Contabilita /></RouteGuard>} />
            <Route path="/produzione" element={<RouteGuard page="produzione"><ProdDashboard /></RouteGuard>} />
            <Route path="/produzione/board" element={<RouteGuard page="produzione"><ProdBoard /></RouteGuard>} />
            <Route path="/produzione/magazzino" element={<RouteGuard page="produzione"><ProdInventory /></RouteGuard>} />
            <Route path="/produzione/trova-materiale" element={<RouteGuard page="produzione"><ProdFindMaterial /></RouteGuard>} />
            <Route path="/produzione/chat" element={<RouteGuard page="produzione"><ProdChat /></RouteGuard>} />
            <Route path="/produzione/logistica" element={<RouteGuard page="produzione"><ProdLogistica /></RouteGuard>} />
            <Route path="/produzione/preparazione" element={<RouteGuard page="produzione"><ProdPreparazione /></RouteGuard>} />
            <Route path="/produzione/acquisti" element={<RouteGuard page="produzione"><ProdAcquisti /></RouteGuard>} />
            <Route path="/produzione/amministrazione" element={<RouteGuard page="produzione"><ProdAmministrazione /></RouteGuard>} />
            <Route path="/produzione/log" element={<RouteGuard page="produzione"><ProdLog /></RouteGuard>} />
            <Route path="/admin/utenti" element={<AdminUsers />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
