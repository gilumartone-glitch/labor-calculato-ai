import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import Flow from "./pages/Flow.tsx";
import Falegnameria from "./pages/Falegnameria.tsx";
import Montaggi from "./pages/Montaggi.tsx";
import MontaggiPianificazione from "./pages/MontaggiPianificazione.tsx";
import Contabilita from "./pages/Contabilita.tsx";
import AdminUsers from "./pages/AdminUsers.tsx";
import Hub from "./pages/Hub.tsx";
import { RouteGuard } from "@/components/RouteGuard";
import ProdDashboard from "./pages/produzione/ProdDashboard.tsx";
import ProdBoard from "./pages/produzione/ProdBoard.tsx";
import ProdInventory from "./pages/produzione/ProdInventory.tsx";
import ProdFindMaterial from "./pages/produzione/ProdFindMaterial.tsx";
import ProdChat from "./pages/produzione/ProdChat.tsx";
import ProdLogistica from "./pages/produzione/ProdLogistica.tsx";
import ProdAmministrazione from "./pages/produzione/ProdAmministrazione.tsx";
import ProdPreparazione from "./pages/produzione/ProdPreparazione.tsx";
import ProdAcquisti from "./pages/produzione/ProdAcquisti.tsx";
import ProdLog from "./pages/produzione/ProdLog.tsx";
import MagazzinoView from "./pages/MagazzinoView.tsx";
import Marketing from "./pages/Marketing.tsx";
import Record from "./pages/Record.tsx";
import { FloatingHubButton } from "@/components/HubLink";

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
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
