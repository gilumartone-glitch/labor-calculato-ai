import { useState } from "react";
import { ClipboardCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PianificazioneSection } from "./PianificazioneSection";
import { AttrezziMaterialiPicker } from "./AttrezziMaterialiPicker";
import { useAssignmentItems } from "@/lib/montaggi/catalog";
import { useCloudWorkspace } from "@/hooks/useCloudWorkspace";
import { useAuth } from "@/hooks/useAuth";

type ProjectSummary = {
  workers: Array<{ name: string; role?: string }>;
  tools: Array<{ name: string; qty?: number }>;
  materials: Array<{ name: string; qty?: number; unit?: string }>;
  address?: string;
};

type Props = {
  draftId: string;
  cantiereLabel: string;
  project: ProjectSummary;
};

type ExtraOp = { id: string; name: string; role?: string; userId?: string };

/** Tab "Assegnazione" interno al progetto. Vista calendario 2 settimane + attrezzi/materiali reali + import da progetto. */
export const AssegnazioneSection = ({ draftId, cantiereLabel, project }: Props) => {
  const { user } = useAuth();
  const { add: addItem } = useAssignmentItems(draftId);
  const extras = useCloudWorkspace<ExtraOp[]>(`montaggi:planning-extras:${draftId}`, []);
  const [busy, setBusy] = useState(false);

  const importFromProject = async () => {
    if (!user) return toast.error("Non autenticato");
    setBusy(true);
    try {
      // 1) Lavoratori → aggiunti agli operai del calendario (extras condivisi)
      const slugName = (name: string) => `proj:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const existing = new Set((extras.state ?? []).map((e) => e.name.trim().toLowerCase()));
      const additions: ExtraOp[] = project.workers
        .filter((w) => w.name?.trim() && !existing.has(w.name.trim().toLowerCase()))
        .map((w) => ({ id: slugName(w.name), name: w.name.trim(), role: w.role ?? "" }));
      if (additions.length > 0) {
        extras.setState([...(extras.state ?? []), ...additions]);
      }

      // 2) Date stimate → se project.date esiste, non auto-assegna (lasciamo decidere dal calendario).
      //    Lo facciamo solo se l'utente ha indicato date stimate (per ora skip — il calendario lo gestisce manualmente).

      // 3) Attrezzi e materiali → inserisci come AssignmentItem
      let count = 0;
      for (const t of project.tools.filter((x) => x.name?.trim())) {
        await addItem({
          kind: "attrezzo",
          ref_nome: t.name.trim(),
          qty: t.qty ?? 1,
          unita: "pz",
        });
        count++;
      }
      for (const m of project.materials.filter((x) => x.name?.trim())) {
        await addItem({
          kind: "materiale",
          ref_nome: m.name.trim(),
          qty: m.qty ?? 1,
          unita: m.unit ?? "pz",
        });
        count++;
      }

      toast.success(`Riprese: ${additions.length} lavoratori, ${count} voci attrezzi/materiali`);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Assegnazione</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Pianificazione reale di chi va in cantiere, con quali attrezzi e materiali.</p>
          </div>
          <Button onClick={importFromProject} disabled={busy}>
            <Wrench className="h-4 w-4" />Riprendi da progetto
          </Button>
        </CardHeader>
      </Card>

      <AttrezziMaterialiPicker commessaId={draftId} />

      <PianificazioneSection
        draftId={draftId}
        cantiereLabel={cantiereLabel}
        defaultWorkers={project.workers}
        projectAddress={project.address}
        projectMaterials={project.materials}
        projectTools={project.tools}
        daysCount={14}
      />
    </div>
  );
};
