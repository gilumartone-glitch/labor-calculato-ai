import { Monitor } from "lucide-react";

const RELEASE_URL = "https://github.com/gilumartone-glitch/workprice-buddy-new/releases/latest";

export const DownloadDesktopButton = () => {
  if (typeof window !== "undefined" && window.electronAPI?.isElectron) return null;
  return (
    <a
      href={RELEASE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Scarica il programma per PC (Windows)"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider border-2 border-primary/40 text-primary hover:border-primary hover:bg-primary/5 rounded-sm"
    >
      <Monitor className="w-3 h-3" />
      Scarica per PC
    </a>
  );
};
