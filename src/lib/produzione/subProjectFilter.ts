/** Filtra lo snapshot di un progetto mantenendo SOLO i pezzi che
 *  appartengono al sub-progetto ("prodotto finito") indicato.
 *
 *  Le righe non taggate per sub-progetto (MaterialLine, OperationLine,
 *  PerimeterLine, TransportLine, salesCarts) sono condivise a livello di
 *  reparto e restano invariate. Un reparto che al termine del filtro non ha
 *  più né pezzi né materiali manuali viene RIMOSSO da `departments` (così
 *  l'inferenza reparti in `snapshot.ts` lo esclude correttamente).
 *
 *  Se `subProjectId` è null/undefined restituisce lo snapshot originale. */
export const filterSnapshotBySubProject = <T extends Record<string, any>>(
  snap: T,
  subProjectId: string | null | undefined,
  subProjectName?: string,
): T => {
  if (!snap || !subProjectId) return snap;
  const clone: any = JSON.parse(JSON.stringify(snap));

  const keepPiece = (p: any) => (p?.subProjectId ?? null) === subProjectId;

  const filterState = (state: any) => {
    if (!state) return state;
    if (Array.isArray(state.pieces)) {
      state.pieces = state.pieces.filter(keepPiece);
    }
    return state;
  };

  const hasContent = (state: any) =>
    (state?.pieces?.length ?? 0) > 0 || (state?.materials?.length ?? 0) > 0;

  // summary shape
  if (Array.isArray(clone.departments)) {
    clone.departments = clone.departments
      .map((d: any) => {
        d.state = filterState(d.state);
        if (!hasContent(d.state)) {
          // azzera i totali per evitare che venga considerato attivo altrove
          d.totals = { ...(d.totals ?? {}), materials: 0, total: 0 };
        }
        return d;
      })
      .filter((d: any) => hasContent(d.state));
  }

  // department shape (source === "department")
  if (clone.state) clone.state = filterState(clone.state);

  // designState mirror (usato lato produzione per rileggere per-reparto)
  if (clone.designState && typeof clone.designState === "object") {
    for (const k of Object.keys(clone.designState)) {
      const v = clone.designState[k];
      if (v && typeof v === "object" && Array.isArray(v.pieces)) {
        clone.designState[k] = filterState(v);
      }
    }
  }

  clone.filterSubProjectId = subProjectId;
  if (subProjectName) clone.filterSubProjectName = subProjectName;
  return clone as T;
};
