import { HardHat } from "lucide-react";
import { HubLink } from "@/components/HubLink";
import { AdminUsersLink } from "@/components/AdminUsersLink";
import { PianificazioneSection } from "@/components/montaggi/PianificazioneSection";

export default function MontaggiPianificazione() {
  return (
    <div data-dept="montaggi" className="min-h-screen bg-dept-soft/50 text-foreground">
      <header className="sticky top-0 z-20 border-b-2 border-dept bg-paper">
        <div className="container flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-dept text-dept-foreground"><HardHat className="h-5 w-5" /></div>
            <div>
              <h1 className="font-display text-2xl font-semibold leading-none">Montaggi</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Panoramica cantieri, operai e calendario settimanale</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HubLink />
            <AdminUsersLink variant="outline" />
          </div>
        </div>
      </header>

      <main className="container py-8">
        <PianificazioneSection draftId="global" cantiereLabel="Globale" mode="global" />
      </main>
    </div>
  );
}
