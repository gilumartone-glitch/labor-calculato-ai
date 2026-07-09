import { supabase } from "@/integrations/supabase/client";

export type DepNode = { kind: "task" | "sub"; id: string };

const key = (n: DepNode) => `${n.kind}:${n.id}`;

/**
 * Verifica se aggiungere una dipendenza `from` → `to` (from è bloccato da to)
 * creerebbe un ciclo nel grafo delle dipendenze.
 *
 * Ritorna true se OK (nessun ciclo), false + path se cicla.
 * Considera dipendenze già in coda (pending) non ancora salvate.
 */
export async function checkDependencyCycle(
  from: DepNode,
  to: DepNode,
  pending: Array<{ from: DepNode; to: DepNode }> = []
): Promise<{ ok: true } | { ok: false; path: DepNode[] }> {
  // Auto-loop
  if (key(from) === key(to)) {
    return { ok: false, path: [from, to] };
  }

  // Carica tutti gli archi esistenti
  const [{ data: taskDeps }, { data: subs }] = await Promise.all([
    supabase.from("admin_task_dependencies" as any).select("task_id, depends_on_task_id, depends_on_sub_order_id"),
    supabase.from("production_sub_orders" as any).select("id, depends_on, depends_on_task_id"),
  ]);

  // Adjacency list: node → dipende da [nodes]
  const adj = new Map<string, DepNode[]>();
  const push = (a: DepNode, b: DepNode) => {
    const k = key(a);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push(b);
  };

  for (const d of (taskDeps ?? []) as any[]) {
    const src: DepNode = { kind: "task", id: d.task_id };
    if (d.depends_on_task_id) push(src, { kind: "task", id: d.depends_on_task_id });
    if (d.depends_on_sub_order_id) push(src, { kind: "sub", id: d.depends_on_sub_order_id });
  }
  for (const s of (subs ?? []) as any[]) {
    const src: DepNode = { kind: "sub", id: s.id };
    if (s.depends_on) push(src, { kind: "sub", id: s.depends_on });
    if (s.depends_on_task_id) push(src, { kind: "task", id: s.depends_on_task_id });
  }
  for (const p of pending) push(p.from, p.to);

  // Aggiungi l'arco proposto e cerca ciclo: BFS da `to` seguendo gli archi.
  // Cicla se raggiungo `from`.
  push(from, to);

  const target = key(from);
  const start = key(to);
  const visited = new Set<string>([start]);
  const parent = new Map<string, string>();
  const queue: string[] = [start];

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) {
      // Ricostruisci path
      const path: DepNode[] = [];
      let n: string | undefined = cur;
      while (n) {
        const [kind, id] = n.split(":") as ["task" | "sub", string];
        path.unshift({ kind, id });
        n = parent.get(n);
      }
      return { ok: false, path };
    }
    for (const next of adj.get(cur) ?? []) {
      const nk = key(next);
      if (!visited.has(nk)) {
        visited.add(nk);
        parent.set(nk, cur);
        queue.push(nk);
      }
    }
  }
  return { ok: true };
}
