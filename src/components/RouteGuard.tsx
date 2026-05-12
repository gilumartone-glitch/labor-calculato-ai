import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions, PageKey, Level } from "@/hooks/usePermissions";
import { Loader2, Lock } from "lucide-react";

type Props = {
  page: PageKey;
  required?: Level;
  children: ReactNode;
};

export const RouteGuard = ({ page, required = "read", children }: Props) => {
  const { user, loading: authLoading } = useAuth();
  const { loading, isAdmin, approved, can } = usePermissions();

  if (authLoading || loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin && !approved) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center border-2 border-ink bg-paper p-8 rounded-sm">
          <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <h1 className="font-display text-2xl font-semibold mb-2">Account in attesa di approvazione</h1>
          <p className="text-sm text-muted-foreground">Un amministratore deve abilitare il tuo account e assegnarti i permessi prima che tu possa accedere.</p>
        </div>
      </div>
    );
  }

  if (!can(page, required)) {
    return <Navigate to="/hub" replace />;
  }

  return <>{children}</>;
};