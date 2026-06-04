import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Download,
  FileText,
  Wrench,
  Layers,
  Move,
  Package,
  Plus,
  Printer,
  Ruler,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { eur, uid } from "@/lib/format";
import { AdminUsersLink } from "@/components/AdminUsersLink";
import { HubLink } from "@/components/HubLink";
import { useCloudWorkspace } from "@/hooks/useCloudWorkspace";
import { LavorazioneGuidedForm, GuidedValue, emptyGuided } from "@/components/shared/LavorazioneGuidedForm";
import { supabase } from "@/integrations/supabase/client";
import {
  loadSharedWorkshopMaterials,
  saveSharedWorkshopMaterials,
  loadSharedWorkshopWorkers,
  saveSharedWorkshopWorkers,
  starterWorkshopMaterials,
  workerBaseRal,
  workerHourlyCost,
  workerInail,
  workerInps,
  workerTfr,
  type WorkshopMaterial,
  type WorkshopMaterialCategory,
} from "@/lib/workshop-shared";
import { AssegnazioneSection } from "@/components/montaggi/AssegnazioneSection";
import { ClipboardCheck } from "lucide-react";
import { fetchDipendenti, filterDipendentiByMacro, dipendenteHourlyCost, type Dipendente } from "@/lib/dipendenti";


type WorkerProfile = {
  id: string;
  name: string;
  hourlyRate?: number;
  ral: number;
  inpsPct: number;
  inailPct: number;
  tfrPct: number;
  extraCosts: number;
  annualHours: number;
};

type LaborLine = { id: string; workerId: string; hours: number; travel?: boolean };
type TransportLine = { id: string; description: string; quantity: number; unitCost: number };
type MaterialCategory = WorkshopMaterialCategory;
type WoodMaterial = WorkshopMaterial;
type MaterialLine = { id: string; materialId: string; quantity: number; unitCost?: number };
type ShapeType = "rect" | "l" | "base";
type DrawingElement = {
  id: string;
  type: ShapeType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
  unit: "mm" | "cm";
  materialIds: string[];
};
type WoodSection = "progetto" | "materiali" | "lavoratori" | "disegno" | "assegnazione";

type ToolLine = { id: string; name: string; qty?: number };

type WoodProject = {
  name: string;
  description: string;
  customer: string;
  address: string;
  date: string;
  workers: WorkerProfile[];
  labor: LaborLine[];
  transports: TransportLine[];
  materialCatalog: WoodMaterial[];
  materials: MaterialLine[];
  marginPct: number;
  elements: DrawingElement[];
  tools: ToolLine[];
  guided?: import("@/components/shared/LavorazioneGuidedForm").GuidedValue;
};

type LegacyMaterialLine = Partial<WoodMaterial> & Partial<MaterialLine> & { id: string };
type StoredWoodProject = Omit<Partial<WoodProject>, "materials"> & { materials?: LegacyMaterialLine[] };

type MontaggiProps = { embedded?: boolean };

const STORAGE_KEY = "officina:montaggi-module:v2";
const LEGACY_STORAGE_KEY = "officina:montaggi-module:v1";

const defaultWorkers: WorkerProfile[] = [
  { id: uid(), name: "Montatore senior", hourlyRate: 0, ral: 0, inpsPct: 30, inailPct: 3, tfrPct: 8.33, extraCosts: 0, annualHours: 1720 },
  { id: uid(), name: "Montatore junior", hourlyRate: 0, ral: 0, inpsPct: 30, inailPct: 3, tfrPct: 8.33, extraCosts: 0, annualHours: 1720 },
  { id: uid(), name: "Aiuto montatore", hourlyRate: 0, ral: 0, inpsPct: 24, inailPct: 3, tfrPct: 8.33, extraCosts: 0, annualHours: 1720 },
];

const starterMaterials = starterWorkshopMaterials;

const initialProject = (): WoodProject => ({
  name: "Nuovo montaggio",
  description: "",
  customer: "",
  address: "",
  date: new Date().toISOString().slice(0, 10),
  workers: defaultWorkers,
  labor: [{ id: uid(), workerId: defaultWorkers[0].id, hours: 1 }],
  transports: [],
  materialCatalog: starterMaterials(),
  materials: [],
  marginPct: 30,
  elements: [],
  tools: [],
});

const categoryLabel: Record<MaterialCategory, string> = {
  legno: "Materiali di montaggio",
  plastica: "Elementi da posare",
  accessori: "Accessori, fissaggi e consumabili",
};

const categoryDefaults: Record<MaterialCategory, Partial<WoodMaterial>> = {
  legno: { name: "Nuovo materiale posa", detail: "Materiale di posa", thickness: 18, width: 252, height: 125, sizeUnit: "cm", unit: "pz" },
  plastica: { name: "Nuovo elemento da posare", detail: "Zona montaggio da installare", thickness: 5, width: 205, height: 305, sizeUnit: "cm", unit: "pz" },
  accessori: { name: "Nuovo fissaggio / consumabile", detail: "Voce personalizzata", thickness: 0, width: 0, height: 0, sizeUnit: "cm", unit: "pz" },
};

const sectionTabs: { key: WoodSection; label: string; icon: typeof FileText }[] = [
  { key: "progetto", label: "Progetto", icon: FileText },
  { key: "materiali", label: "Materiali", icon: Package },
  
  { key: "assegnazione", label: "Assegnazione", icon: ClipboardCheck },
  { key: "disegno", label: "Disegnatore", icon: Ruler },
];

const hydrateProject = (rawProject: StoredWoodProject): WoodProject => {
  const base = initialProject();
  const legacyRows = Array.isArray(rawProject.materials) ? rawProject.materials : [];
  const legacyCatalog = legacyRows
    .filter((m) => m.category && m.name && !m.materialId)
    .map((m) => ({
      id: m.id,
      category: m.category as MaterialCategory,
      name: m.name ?? "Materiale",
      detail: m.detail ?? "",
      thickness: Number(m.thickness) || 0,
      width: Number(m.width) || 0,
      height: Number(m.height) || 0,
      sizeUnit: (m.sizeUnit === "mm" ? "mm" : "cm") as "mm" | "cm",
      unit: m.unit ?? "pz",
      unitCost: Number(m.unitCost) || 0,
    }));
  const catalog = rawProject.materialCatalog?.length ? rawProject.materialCatalog : legacyCatalog.length ? legacyCatalog : base.materialCatalog;
  const materials = legacyRows.map((m) => ({
    id: m.materialId ? m.id : uid(),
    materialId: m.materialId ?? m.id,
    quantity: Number(m.quantity) || 1,
    unitCost: typeof m.unitCost === "number" && m.materialId ? m.unitCost : undefined,
  }));

  return {
    ...base,
    ...rawProject,
    address: rawProject.address ?? "",
    tools: Array.isArray(rawProject.tools) ? rawProject.tools : [],
    workers: rawProject.workers?.length ? rawProject.workers : base.workers,
    labor: rawProject.labor?.length ? rawProject.labor : base.labor,
    transports: Array.isArray(rawProject.transports) ? rawProject.transports : [],
    materialCatalog: catalog,
    materials,
    elements: Array.isArray(rawProject.elements) ? rawProject.elements : [],
  };
};

const materialLabel = (m?: WoodMaterial) => {
  if (!m) return "Materiale non selezionato";
  const size = m.width || m.height ? ` · ${m.width}×${m.height} ${m.sizeUnit}` : "";
  const thickness = m.thickness ? ` · ${m.thickness} mm` : "";
  return `${m.name}${thickness}${size}${m.detail ? ` · ${m.detail}` : ""}`;
};

const drawElement = (ctx: CanvasRenderingContext2D, el: DrawingElement, selected: boolean, materials: WoodMaterial[]) => {
  const root = getComputedStyle(document.documentElement);
  const ink = `hsl(${root.getPropertyValue("--ink")})`;
  const dept = `hsl(${root.getPropertyValue("--dept")})`;
  const soft = `hsl(${root.getPropertyValue("--dept-soft")})`;
  const paper = `hsl(${root.getPropertyValue("--paper")})`;
  ctx.save();
  ctx.lineWidth = selected ? 4 : 2;
  ctx.strokeStyle = selected ? dept : ink;
  ctx.fillStyle = soft;
  if (el.type === "l") {
    const cutW = el.w * 0.42;
    const cutH = el.h * 0.42;
    ctx.beginPath();
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x + el.w, el.y);
    ctx.lineTo(el.x + el.w, el.y + el.h - cutH);
    ctx.lineTo(el.x + cutW, el.y + el.h - cutH);
    ctx.lineTo(el.x + cutW, el.y + el.h);
    ctx.lineTo(el.x, el.y + el.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(el.x, el.y, el.w, el.h);
    ctx.strokeRect(el.x, el.y, el.w, el.h);
  }
  ctx.fillStyle = ink;
  ctx.font = "600 13px Inter, sans-serif";
  ctx.fillText(el.label || "Zona montaggio", el.x + 10, el.y + 22);
  ctx.font = "500 11px JetBrains Mono, monospace";
  ctx.fillText(`${el.w}×${el.h}×${el.d} ${el.unit}`, el.x + 10, el.y + Math.max(42, el.h - 12));
  if (el.materialIds.length) {
    const firstMaterial = materials.find((m) => m.id === el.materialIds[0]);
    ctx.fillStyle = dept;
    ctx.fillRect(el.x + 8, el.y + 30, Math.min(el.w - 16, 150), 18);
    ctx.fillStyle = paper;
    ctx.font = "600 10px Inter, sans-serif";
    ctx.fillText(materialLabel(firstMaterial).slice(0, 22), el.x + 14, el.y + 43);
  }
  ctx.restore();
};

export default function Montaggi({ embedded = false }: MontaggiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [project, setProject] = useState<WoodProject>(() => initialProject());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<WoodSection>("progetto");
  const [projectReady, setProjectReady] = useState(false);
  // Scope per-draft: ogni progetto Flow ha il suo modulo Montaggi indipendente.
  const draftId = (typeof window !== "undefined" && localStorage.getItem("officina:active-draft")) || "default";
  const DRAFT_STORAGE_KEY = `${STORAGE_KEY}:${draftId}`;
  const cloud = useCloudWorkspace<WoodProject | null>(`montaggi_project:${draftId}`, null, {
    localStorageKeys: [DRAFT_STORAGE_KEY, STORAGE_KEY, LEGACY_STORAGE_KEY],
    hydrate: (raw) => hydrateProject(raw as WoodProject),
  });
  const lastAppliedRef = useRef<string>("");

  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null; settori?: string[] | null }[]>([]);
  useEffect(() => {
    supabase.from("profiles").select("id, display_name, settori").then(({ data }) => {
      if (data) setProfiles(data as never);
    });
  }, []);
  useEffect(() => {
    if (!cloud.ready) return;
    if (cloud.state) {
      const serialized = JSON.stringify(cloud.state);
      if (serialized !== lastAppliedRef.current) {
        lastAppliedRef.current = serialized;
        setProject({
          ...cloud.state,
          materialCatalog: loadSharedWorkshopMaterials(starterMaterials()),
          workers: loadSharedWorkshopWorkers(cloud.state.workers?.length ? cloud.state.workers : defaultWorkers),
        });
      }
    } else {
      setProject((p) => ({
        ...p,
        materialCatalog: loadSharedWorkshopMaterials(p.materialCatalog),
        workers: loadSharedWorkshopWorkers(p.workers),
      }));
    }
    setProjectReady(true);
  }, [cloud.ready, cloud.state]);

  useEffect(() => {
    if (!projectReady) return;
    saveSharedWorkshopMaterials(project.materialCatalog);
    saveSharedWorkshopWorkers(project.workers);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(project));
    window.dispatchEvent(new Event("workshop-summary-updated"));
    const serialized = JSON.stringify(project);
    if (serialized !== lastAppliedRef.current && cloud.ready) {
      lastAppliedRef.current = serialized;
      cloud.setState(project);
    }
  }, [project, projectReady, cloud.ready]);

  const saveProject = () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(project));
    toast.success("Progetto Montaggi salvato");
  };

  const materialById = useMemo(() => new Map(project.materialCatalog.map((m) => [m.id, m])), [project.materialCatalog]);

  const totals = useMemo(() => {
    const labor = project.labor.reduce((sum, line) => {
      const worker = project.workers.find((w) => w.id === line.workerId);
      return sum + (worker ? (workerHourlyCost(worker) + (line.travel ? 2.5 : 0)) * line.hours : 0);
    }, 0);
    const transports = project.transports.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
    const materialsByCategory = project.materials.reduce(
      (acc, line) => {
        const item = materialById.get(line.materialId);
        if (!item) return acc;
        return { ...acc, [item.category]: acc[item.category] + line.quantity * (line.unitCost ?? item.unitCost) };
      },
      { legno: 0, plastica: 0, accessori: 0 } as Record<MaterialCategory, number>,
    );
    const rawMaterials = materialsByCategory.legno + materialsByCategory.plastica;
    const production = labor + rawMaterials + materialsByCategory.accessori + transports;
    const marginEuro = production * (project.marginPct / 100);
    const sale = production + marginEuro;
    return { labor, transports, materialsByCategory, rawMaterials, production, marginEuro, sale, markupPct: production ? (marginEuro / production) * 100 : 0 };
  }, [materialById, project]);

  const selectedElement = project.elements.find((el) => el.id === selectedId) ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const root = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `hsl(${root.getPropertyValue("--paper")})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = `hsl(${root.getPropertyValue("--border")})`;
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    project.elements.forEach((el) => drawElement(ctx, el, el.id === selectedId, project.materialCatalog));
  }, [project.elements, project.materialCatalog, selectedId]);

  const updateProject = (patch: Partial<WoodProject>) => setProject((p) => ({ ...p, ...patch }));
  const updateWorker = (id: string, patch: Partial<WorkerProfile>) =>
    updateProject({ workers: project.workers.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const updateMaterialCatalog = (id: string, patch: Partial<WoodMaterial>) =>
    updateProject({ materialCatalog: project.materialCatalog.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const updateMaterialLine = (id: string, patch: Partial<MaterialLine>) =>
    updateProject({ materials: project.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const updateElement = (id: string, patch: Partial<DrawingElement>) =>
    updateProject({ elements: project.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) });

  const addCatalogMaterial = (category: MaterialCategory) => {
    const defaults = categoryDefaults[category];
    updateProject({
      materialCatalog: [...project.materialCatalog, { id: uid(), category, name: defaults.name ?? "", detail: defaults.detail ?? "", thickness: defaults.thickness ?? 0, width: defaults.width ?? 0, height: defaults.height ?? 0, sizeUnit: defaults.sizeUnit ?? "cm", unit: defaults.unit ?? "pz", unitCost: 0 }],
    });
  };

  const addMaterialLine = (category?: MaterialCategory) => {
    const first = project.materialCatalog.find((m) => !category || m.category === category) ?? project.materialCatalog[0];
    if (!first) {
      toast.info("Inserisci prima un materiale nella sottosezione Materiali");
      setSection("materiali");
      return;
    }
    updateProject({ materials: [...project.materials, { id: uid(), materialId: first.id, quantity: 1 }] });
  };

  const addElement = (type: ShapeType) => {
    const el: DrawingElement = { id: uid(), type, label: type === "l" ? "Area a L" : "Zona montaggio", x: 80 + project.elements.length * 24, y: 70 + project.elements.length * 18, w: 180, h: 110, d: 18, unit: "mm", materialIds: [] };
    updateProject({ elements: [...project.elements, el] });
    setSelectedId(el.id);
  };

  const pointOnCanvas = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const hitElement = (clientX: number, clientY: number) => {
    const point = pointOnCanvas(clientX, clientY);
    if (!point) return null;
    return [...project.elements].reverse().find((el) => point.x >= el.x && point.x <= el.x + el.w && point.y >= el.y && point.y <= el.y + el.h) ?? null;
  };

  const handlePointerDown = (clientX: number, clientY: number) => {
    const hit = hitElement(clientX, clientY);
    setSelectedId(hit?.id ?? null);
    const point = pointOnCanvas(clientX, clientY);
    if (hit && point) dragRef.current = { id: hit.id, offsetX: point.x - hit.x, offsetY: point.y - hit.y };
  };

  const handlePointerMove = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const point = pointOnCanvas(clientX, clientY);
    if (!drag || !point) return;
    updateElement(drag.id, { x: Math.max(0, Math.round(point.x - drag.offsetX)), y: Math.max(0, Math.round(point.y - drag.offsetY)) });
  };

  const nudgeSelected = (dx: number, dy: number) => {
    if (!selectedElement) return;
    updateElement(selectedElement.id, { x: Math.max(0, selectedElement.x + dx), y: Math.max(0, selectedElement.y + dy) });
  };

  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${project.name || "disegno-montaggi"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const exportPdf = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>${project.name}</title></head><body style="font-family:sans-serif;margin:32px"><h1>${project.name}</h1><img src="${canvas.toDataURL("image/png")}" style="max-width:100%"/><script>window.print()</script></body></html>`);
    win.document.close();
  };

  const content = (
    <>
      {!embedded && (
        <header className="sticky top-0 z-20 border-b-2 border-dept bg-paper">
          <div className="container mx-auto px-3 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-3 py-3 sm:py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-dept text-dept-foreground"><Wrench className="h-5 w-5" /></div>
              <div className="min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-semibold leading-none truncate">Montaggi</h1>
                <p className="hidden sm:block text-xs uppercase tracking-[0.2em] text-muted-foreground">Squadre, trasferte, mezzi e materiali di posa</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AdminUsersLink variant="outline" />
              <Button size="sm" onClick={saveProject}><Save className="h-4 w-4" />Salva</Button>
            </div>
          </div>
        </header>
      )}

        <main className={embedded ? "w-full space-y-6" : "container mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6"}>
        <section className="space-y-6">
          <Card className="border-2 border-dept shadow-soft">
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Montaggi</CardTitle>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {sectionTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <Button key={tab.key} type="button" size="sm" variant={section === tab.key ? "default" : "outline"} onClick={() => setSection(tab.key)}>
                      <Icon className="h-4 w-4" />{tab.label}
                    </Button>
                  );
                })}
                <Button type="button" size="sm" variant="secondary" onClick={saveProject}><Save className="h-4 w-4" />Salva</Button>
              </div>
            </CardHeader>
          </Card>

          {section === "progetto" && (
            <ProjectSection project={project} updateProject={updateProject} updateMaterialLine={updateMaterialLine} addMaterialLine={addMaterialLine} />
          )}

          {section === "lavoratori" && <WorkersSection project={project} updateProject={updateProject} updateWorker={updateWorker} />}
          {section === "materiali" && <MaterialsSection project={project} addCatalogMaterial={addCatalogMaterial} updateMaterialCatalog={updateMaterialCatalog} updateProject={updateProject} />}
          {section === "assegnazione" && <AssegnazioneSection
            draftId={draftId}
            cantiereLabel={project.name || "Cantiere senza nome"}
            project={{
              workers: project.workers.map((w) => ({ name: w.name })),
              tools: (project.tools ?? []).filter((t) => t.name.trim()).map((t) => ({ name: t.name, qty: t.qty })),
              materials: project.materials.map((line) => {
                const item = project.materialCatalog.find((m) => m.id === line.materialId);
                return { name: item ? `${item.name}${item.detail ? ` · ${item.detail}` : ""}` : "Materiale", qty: line.quantity, unit: item?.unit };
              }),
              address: project.address,
            }}
          />}
          {section === "disegno" && (
            <Card className="border-2 border-dept shadow-soft print:hidden">
              <CardHeader className="flex-row items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2"><Ruler className="h-5 w-5" />Schema area montaggio</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => addElement("rect")}>Rettangolo</Button>
                  <Button size="sm" variant="outline" onClick={() => addElement("l")}>L-shape</Button>
                  <Button size="sm" variant="outline" onClick={() => addElement("base")}>Forma base</Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3">
                  <canvas
                    ref={canvasRef}
                    width={860}
                    height={520}
                    className="w-full cursor-move rounded-sm border-2 border-ink bg-paper"
                    onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY)}
                    onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
                    onMouseUp={() => { dragRef.current = null; }}
                    onMouseLeave={() => { dragRef.current = null; }}
                  />
                  <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-background p-2">
                    <Move className="h-4 w-4 text-muted-foreground" />
                    <Button type="button" size="icon" variant="outline" disabled={!selectedElement} onClick={() => nudgeSelected(-10, 0)}><ArrowLeft className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="outline" disabled={!selectedElement} onClick={() => nudgeSelected(10, 0)}><ArrowRight className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="outline" disabled={!selectedElement} onClick={() => nudgeSelected(0, -10)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="outline" disabled={!selectedElement} onClick={() => nudgeSelected(0, 10)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="sm" variant="outline" onClick={exportPng}><Download className="h-4 w-4" />PNG</Button>
                    <Button size="sm" variant="outline" onClick={exportPdf}><Printer className="h-4 w-4" />PDF</Button>
                  </div>
                </div>
                <div className="space-y-3 rounded-sm border border-border bg-background p-3">
                  {selectedElement ? <>
                    <Field label="Etichetta"><Input value={selectedElement.label} onChange={(e) => updateElement(selectedElement.id, { label: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberInput value={selectedElement.w} onChange={(w) => updateElement(selectedElement.id, { w })} prefix="Larghezza" />
                      <NumberInput value={selectedElement.h} onChange={(h) => updateElement(selectedElement.id, { h })} prefix="Altezza" />
                      <NumberInput value={selectedElement.d} onChange={(d) => updateElement(selectedElement.id, { d })} prefix="Profondità" />
                      <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={selectedElement.unit} onChange={(e) => updateElement(selectedElement.id, { unit: e.target.value as "mm" | "cm" })}><option value="mm">mm</option><option value="cm">cm</option></select>
                    </div>
                    <div className="grid grid-cols-2 gap-2"><NumberInput value={selectedElement.x} onChange={(x) => updateElement(selectedElement.id, { x })} prefix="X" /><NumberInput value={selectedElement.y} onChange={(y) => updateElement(selectedElement.id, { y })} prefix="Y" /></div>
                    <Label>Materiali associati</Label>
                    <div className="max-h-48 space-y-1 overflow-auto rounded-sm border border-border p-2">
                      {project.materialCatalog.map((m) => <label key={m.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedElement.materialIds.includes(m.id)} onChange={(e) => updateElement(selectedElement.id, { materialIds: e.target.checked ? [...selectedElement.materialIds, m.id] : selectedElement.materialIds.filter((id) => id !== m.id) })} />{materialLabel(m)}</label>)}
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => { updateProject({ elements: project.elements.filter((el) => el.id !== selectedElement.id) }); setSelectedId(null); }}><Trash2 className="h-4 w-4" />Elimina elemento</Button>
                  </> : <p className="text-sm text-muted-foreground">Seleziona o trascina un elemento sul disegno per quote e materiali.</p>}
                  <div className="space-y-2 border-t border-border pt-3">
                    <Label className="flex items-center gap-2"><Layers className="h-4 w-4" />Elementi</Label>
                    {project.elements.map((el) => <button key={el.id} type="button" onClick={() => setSelectedId(el.id)} className={`w-full rounded-sm border p-2 text-left text-sm ${selectedId === el.id ? "border-dept bg-dept-soft" : "border-border bg-card"}`}>{el.label} · {el.w}×{el.h}×{el.d} {el.unit}</button>)}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </main>

    </>
  );


  return embedded ? content : <div data-dept="montaggi" className="min-h-screen bg-dept-soft/50 text-foreground">{content}</div>;
}

const ProjectSection = ({ project, updateProject, updateMaterialLine, addMaterialLine }: { project: WoodProject; updateProject: (patch: Partial<WoodProject>) => void; updateMaterialLine: (id: string, patch: Partial<MaterialLine>) => void; addMaterialLine: (category?: MaterialCategory) => void }) => {
  const materialById = new Map(project.materialCatalog.map((m) => [m.id, m]));
  const renderUsageRows = (category: MaterialCategory | "materie-prime", emptyText: string) => {
    const allowedCatalog = project.materialCatalog.filter((m) => (category === "materie-prime" ? m.category !== "accessori" : m.category === category));
    const rows = project.materials.filter((line) => {
      const item = materialById.get(line.materialId);
      return category === "materie-prime" ? item?.category !== "accessori" : item?.category === category;
    });

    return <CardContent className="space-y-3">
      {rows.map((line) => {
        const item = materialById.get(line.materialId);
        const unitCost = line.unitCost ?? item?.unitCost ?? 0;
        return <div key={line.id} className="rounded-sm border border-border bg-background p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_90px_110px_130px_110px_40px] xl:items-end">
          <Field label="Voce">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.materialId} onChange={(e) => updateMaterialLine(line.id, { materialId: e.target.value, unitCost: undefined })}>
              {allowedCatalog.map((m) => <option key={m.id} value={m.id}>{categoryLabel[m.category]} · {materialLabel(m)}</option>)}
            </select>
          </Field>
          <Field label="Unità"><div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">{item?.unit ?? "unità"}</div></Field>
          <Field label="Quantità"><NumberInput value={line.quantity} onChange={(quantity) => updateMaterialLine(line.id, { quantity })} prefix="Qtà" /></Field>
          <Field label="Prezzo unitario"><NumberInput value={unitCost} onChange={(value) => updateMaterialLine(line.id, { unitCost: value })} prefix="€/unità" /></Field>
          <Field label="Totale"><div className="flex h-10 items-center font-mono font-semibold">{eur(line.quantity * unitCost)}</div></Field>
          <IconButton onClick={() => updateProject({ materials: project.materials.filter((row) => row.id !== line.id) })} />
          </div>
        </div>;
      })}
      {rows.length === 0 && <p className="rounded-sm border border-border bg-background p-3 text-sm text-muted-foreground">{emptyText}</p>}
    </CardContent>;
  };

  return <>
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Dati progetto</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <Field label="Nome progetto"><Input value={project.name} onChange={(e) => updateProject({ name: e.target.value })} /></Field>
        <Field label="Cliente"><Input value={project.customer} onChange={(e) => updateProject({ customer: e.target.value })} /></Field>
        <Field label="Indirizzo cantiere"><Input value={project.address} onChange={(e) => updateProject({ address: e.target.value })} placeholder="Via, città, CAP" /></Field>
        <Field label="Data"><Input type="date" value={project.date} onChange={(e) => updateProject({ date: e.target.value })} /></Field>
        <div className="md:col-span-2"><Field label="Descrizione"><Input value={project.description} onChange={(e) => updateProject({ description: e.target.value })} /></Field></div>
      </CardContent>
    </Card>

    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Attrezzi da portare in cantiere</CardTitle>
        <Button size="sm" onClick={() => updateProject({ tools: [...(project.tools ?? []), { id: uid(), name: "", qty: 1 }] })}><Plus className="h-4 w-4" />Attrezzo</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {(project.tools ?? []).map((t) => (
          <div key={t.id} className="grid gap-2 md:grid-cols-[1fr_120px_40px] md:items-end">
            <Field label="Attrezzo"><Input value={t.name} onChange={(e) => updateProject({ tools: project.tools.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x) })} placeholder="Es. trapano, livella, ponteggio" /></Field>
            <Field label="Quantità"><NumberInput value={t.qty ?? 1} onChange={(qty) => updateProject({ tools: project.tools.map((x) => x.id === t.id ? { ...x, qty } : x) })} prefix="Qtà" /></Field>
            <IconButton onClick={() => updateProject({ tools: project.tools.filter((x) => x.id !== t.id) })} />
          </div>
        ))}
        {(!project.tools || project.tools.length === 0) && <p className="rounded-sm border border-border bg-background p-3 text-sm text-muted-foreground">Aggiungi qui gli attrezzi che la squadra deve portare in cantiere. La lista comparirà nella pianificazione e nelle notifiche agli operai.</p>}
      </CardContent>
    </Card>

    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Materiali utilizzati in montaggio</CardTitle><Button size="sm" onClick={() => addMaterialLine()}><Plus className="h-4 w-4" />Materiale</Button></CardHeader>
      {renderUsageRows("materie-prime", "Aggiungi qui i materiali usati per questa lavorazione, scegliendoli dall'archivio Materiali.")}
    </Card>

    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Accessori, fissaggi e consumabili utilizzati</CardTitle><Button size="sm" onClick={() => addMaterialLine("accessori")}><Plus className="h-4 w-4" />Accessorio</Button></CardHeader>
      {renderUsageRows("accessori", "Aggiungi qui tasselli, staffe, silicone, minuteria o altri accessori usati nel progetto.")}
    </Card>

    <LaborUsageSection project={project} updateProject={updateProject} />
    <TransportUsageSection project={project} updateProject={updateProject} />
  </>;
};

const TransportUsageSection = ({ project, updateProject }: { project: WoodProject; updateProject: (patch: Partial<WoodProject>) => void }) => (
  <Card className="border-2 border-dept shadow-soft">
    <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Trasporti, trasferte e mezzi</CardTitle><Button size="sm" onClick={() => updateProject({ transports: [...project.transports, { id: uid(), description: "Trasporto / trasferta", quantity: 1, unitCost: 0 }] })}><Plus className="h-4 w-4" />Trasporto / trasferta</Button></CardHeader>
    <CardContent className="space-y-3">
      {project.transports.map((line) => (
        <div key={line.id} className="rounded-sm border border-border bg-background p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_110px_130px_110px_40px] xl:items-end">
          <Field label="Descrizione"><Input value={line.description} onChange={(e) => updateProject({ transports: project.transports.map((t) => t.id === line.id ? { ...t, description: e.target.value } : t) })} /></Field>
          <Field label="Quantità"><NumberInput value={line.quantity} onChange={(quantity) => updateProject({ transports: project.transports.map((t) => t.id === line.id ? { ...t, quantity } : t) })} prefix="Qtà" /></Field>
          <Field label="Prezzo unitario"><NumberInput value={line.unitCost} onChange={(unitCost) => updateProject({ transports: project.transports.map((t) => t.id === line.id ? { ...t, unitCost } : t) })} prefix="€/unità" /></Field>
          <Field label="Totale"><div className="flex h-10 items-center font-mono font-semibold">{eur(line.quantity * line.unitCost)}</div></Field>
          <IconButton onClick={() => updateProject({ transports: project.transports.filter((t) => t.id !== line.id) })} />
          </div>
        </div>
      ))}
      {project.transports.length === 0 && <p className="rounded-sm border border-border bg-background p-3 text-sm text-muted-foreground">Aggiungi qui trasferte, parcheggi, noleggi mezzi, piattaforme o consegne.</p>}
    </CardContent>
  </Card>
);

const LaborUsageSection = ({ project, updateProject }: { project: WoodProject; updateProject: (patch: Partial<WoodProject>) => void }) => {
  const [dips, setDips] = useState<Dipendente[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchDipendenti(true).then((all) => {
      if (!cancelled) setDips(filterDipendentiByMacro(all, "montaggi"));
    });
    return () => { cancelled = true; };
  }, []);
  const costOf = (id: string) => {
    const d = dips.find((x) => `dip:${x.id}` === id);
    if (d) return dipendenteHourlyCost(d);
    const w = project.workers.find((x) => x.id === id);
    return w ? workerHourlyCost(w) : 0;
  };
  const nameOf = (id: string) => {
    const d = dips.find((x) => `dip:${x.id}` === id);
    if (d) return d.nome + (d.funzione ? ` · ${d.funzione}` : "");
    return project.workers.find((x) => x.id === id)?.name ?? "—";
  };
  const options = dips.map((d) => ({ id: `dip:${d.id}`, label: `${d.nome}${d.funzione ? ` · ${d.funzione}` : ""} · ${eur(dipendenteHourlyCost(d))}/h` }));
  return (

  <Card className="border-2 border-dept shadow-soft">
    <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Squadra montaggio e ore</CardTitle><Button size="sm" onClick={() => updateProject({ labor: [...project.labor, { id: uid(), workerId: options[0]?.id ?? "", hours: 1 }] })}><Plus className="h-4 w-4" />Riga</Button></CardHeader>
    <CardContent className="space-y-3">
      {project.labor.map((line) => {
        const hourly = costOf(line.workerId);
        return <div key={line.id} className="rounded-sm border border-border bg-background p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_120px_130px_130px_40px] xl:items-end">
          <Field label="Addetto / squadra">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.workerId} onChange={(e) => updateProject({ labor: project.labor.map((l) => l.id === line.id ? { ...l, workerId: e.target.value } : l) })}>
              <option value="">— Seleziona dipendente —</option>
              {line.workerId && !options.some((o) => o.id === line.workerId) && (
                <option value={line.workerId}>{nameOf(line.workerId)} (non più disponibile)</option>
              )}
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Ore lavorate"><NumberInput value={line.hours} onChange={(hours) => updateProject({ labor: project.labor.map((l) => l.id === line.id ? { ...l, hours } : l) })} prefix="Ore" /></Field>
          <Field label="Trasferta"><label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><input type="checkbox" checked={line.travel ?? false} onChange={(e) => updateProject({ labor: project.labor.map((l) => l.id === line.id ? { ...l, travel: e.target.checked } : l) })} />+20€/giorno</label></Field>
          <Field label="Totale"><div className="flex h-10 items-center font-mono font-semibold">{eur((hourly + (line.travel ? 2.5 : 0)) * line.hours)}</div></Field>
          <IconButton onClick={() => updateProject({ labor: project.labor.filter((l) => l.id !== line.id) })} />
          </div>
        </div>;
      })}
      {options.length === 0 && (
        <p className="rounded-sm border border-border bg-background p-3 text-sm text-muted-foreground">Nessun dipendente assegnato al macroreparto Montaggi. Aggiungili dalla sezione Dipendenti nell'Hub.</p>
      )}
    </CardContent>
  </Card>
  );
};


const WorkersSection = ({ project, updateProject, updateWorker }: { project: WoodProject; updateProject: (patch: Partial<WoodProject>) => void; updateWorker: (id: string, patch: Partial<WorkerProfile>) => void }) => (
  <>
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Archivio squadre e montatori</CardTitle><Button size="sm" onClick={() => updateProject({ workers: [...project.workers, { id: uid(), name: "Nuovo profilo", hourlyRate: 0, ral: 0, inpsPct: 30, inailPct: 3, tfrPct: 8.33, extraCosts: 0, annualHours: 1720 }] })}><Plus className="h-4 w-4" />Profilo</Button></CardHeader>
      <CardContent className="space-y-3">
        {project.workers.map((w) => (
          <div key={w.id} className="rounded-sm border border-border bg-background p-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.35fr)_130px_130px_140px_150px] xl:items-end">
              <Field label="Figura / squadra"><Input value={w.name} onChange={(e) => updateWorker(w.id, { name: e.target.value })} /></Field>
              <Field label="Netto orario"><NumberInput value={w.hourlyRate ?? 0} onChange={(hourlyRate) => updateWorker(w.id, { hourlyRate })} prefix="€/h" /></Field>
              <Field label="Ore annue"><NumberInput value={w.annualHours} onChange={(annualHours) => updateWorker(w.id, { annualHours })} prefix="Ore annue" /></Field>
              <Field label="Costo azienda/h"><div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm font-semibold text-dept">{eur(workerHourlyCost(w))}/h</div></Field>
              <Field label="Costo giornata 8h"><div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm font-semibold text-dept">{eur(workerHourlyCost(w) * 8)}</div></Field>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
              <Field label="RAL calcolata"><ReadOnlyMoney value={workerBaseRal(w)} /></Field>
              <Field label="INPS"><ReadOnlyMoney value={workerInps(w)} /></Field>
              <Field label="INAIL"><ReadOnlyMoney value={workerInail(w)} /></Field>
              <Field label="TFR"><ReadOnlyMoney value={workerTfr(w)} /></Field>
              <Field label="Costi extra"><NumberInput value={w.extraCosts} onChange={(extraCosts) => updateWorker(w.id, { extraCosts })} prefix="Extra" /></Field>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  </>
);

const MaterialsSection = ({ project, addCatalogMaterial, updateMaterialCatalog, updateProject }: { project: WoodProject; addCatalogMaterial: (category: MaterialCategory) => void; updateMaterialCatalog: (id: string, patch: Partial<WoodMaterial>) => void; updateProject: (patch: Partial<WoodProject>) => void }) => {
  return <>
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader><CardTitle>Archivio materiali e accessori montaggio</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {(["legno", "plastica", "accessori"] as MaterialCategory[]).map((category) => (
          <div key={category} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-xl font-semibold">{categoryLabel[category]}</h3><Button size="sm" variant="outline" onClick={() => addCatalogMaterial(category)}><Plus className="h-4 w-4" />Materiale</Button></div>
            {project.materialCatalog.filter((m) => m.category === category).map((m) => (
              <div key={m.id} className="rounded-sm border border-border bg-background p-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_repeat(6,minmax(90px,0.65fr))_40px] 2xl:items-end">
                <Field label="Tipo"><Input value={m.name} onChange={(e) => updateMaterialCatalog(m.id, { name: e.target.value })} placeholder="Tipo" /></Field>
                <Field label="Descrizione"><Input value={m.detail} onChange={(e) => updateMaterialCatalog(m.id, { detail: e.target.value })} placeholder="Note" /></Field>
                <Field label="Spessore"><NumberInput value={m.thickness} onChange={(thickness) => updateMaterialCatalog(m.id, { thickness })} prefix="mm" /></Field>
                <Field label="Larghezza"><NumberInput value={m.width} onChange={(width) => updateMaterialCatalog(m.id, { width })} prefix="Larg." /></Field>
                <Field label="Altezza"><NumberInput value={m.height} onChange={(height) => updateMaterialCatalog(m.id, { height })} prefix="Alt." /></Field>
                <Field label="Unità misura"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={m.sizeUnit} onChange={(e) => updateMaterialCatalog(m.id, { sizeUnit: e.target.value as "cm" | "mm" })}><option value="cm">cm</option><option value="mm">mm</option></select></Field>
                <Field label="Unità prezzo"><Input value={m.unit} onChange={(e) => updateMaterialCatalog(m.id, { unit: e.target.value })} placeholder="mq" /></Field>
                <Field label="Prezzo"><NumberInput value={m.unitCost} onChange={(unitCost) => updateMaterialCatalog(m.id, { unitCost })} prefix="€/unità" /></Field>
                <IconButton onClick={() => updateProject({ materialCatalog: project.materialCatalog.filter((row) => row.id !== m.id), materials: project.materials.filter((row) => row.materialId !== m.id), elements: project.elements.map((el) => ({ ...el, materialIds: el.materialIds.filter((id) => id !== m.id) })) })} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>

  </>;
};

const Field = forwardRef<HTMLDivElement, { label: string; children: ReactNode }>(({ label, children }, ref) => <div ref={ref} className="min-w-0 space-y-1.5"><Label className="label-cap block leading-tight">{label}</Label>{children}</div>);
Field.displayName = "Field";
const ReadOnlyMoney = ({ value }: { value: number }) => <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm font-semibold">{eur(value)}</div>;
const NumberInput = ({ value, onChange, prefix }: { value: number; onChange: (n: number) => void; prefix?: string }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) && value !== 0 ? String(value) : "");
  return <Input className="font-mono" type="number" min="0" step="0.01" value={shown} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value === "" ? 0 : Number(e.target.value) || 0); }} onBlur={() => setDraft(null)} placeholder={prefix ?? "0"} title={prefix} />;
};
const IconButton = ({ onClick }: { onClick: () => void }) => <Button className="self-end justify-self-start xl:justify-self-end" type="button" size="icon" variant="ghost" onClick={onClick} aria-label="Elimina riga"><Trash2 className="h-4 w-4" /></Button>;
const Summary = ({ label, value, strong, suffix }: { label: string; value: number; strong?: boolean; suffix?: string }) => <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{label}</span><span className={`font-mono ${strong ? "text-xl font-bold text-dept" : "font-semibold"}`}>{suffix ? `${value.toFixed(2)}${suffix}` : eur(value)}</span></div>;
