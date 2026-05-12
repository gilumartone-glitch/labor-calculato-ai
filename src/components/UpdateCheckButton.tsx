import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      checkForUpdates: () => Promise<void>;
      getAppVersion: () => Promise<string>;
    };
  }
}

export const UpdateCheckButton = () => {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(setVersion).catch(() => {});
    }
  }, []);

  if (!window.electronAPI?.isElectron) return null;

  return (
    <button
      onClick={async () => {
        toast.info("Controllo aggiornamenti…");
        try { await window.electronAPI!.checkForUpdates(); }
        catch { toast.error("Errore controllo aggiornamenti"); }
      }}
      title={version ? `Versione installata: ${version}` : "Controlla aggiornamenti"}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider border-2 border-ink/30 hover:border-ink rounded-sm"
    >
      <Download className="w-3 h-3" />
      Aggiornamenti
      {version && <span className="font-mono text-[9px] opacity-60">v{version}</span>}
    </button>
  );
};
