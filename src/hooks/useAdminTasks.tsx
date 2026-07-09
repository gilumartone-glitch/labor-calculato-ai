import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { TaskCategory, TaskStatus, TaskPriority } from "@/lib/tasks/constants";

export type ChecklistItem = { id: string; text: string; done: boolean };
export type Attachment = { name: string; url: string; size?: number };

export type AdminTask = {
  id: string;
  category: TaskCategory;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  responsible_id: string | null;
  assignee_ids: string[];
  start_at: string | null;
  due_at: string | null;
  reminder_at: string | null;
  checklist: ChecklistItem[];
  attachments: Attachment[];
  linked_commessa_id: string | null;
  linked_contact_id: string | null;
  linked_sub_project: { draftId?: string; subProjectId?: string; name?: string } | null;
  created_by: string;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
};

export const useAdminTasks = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_tasks" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setTasks(data as unknown as AdminTask[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("admin_tasks_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_tasks" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const create = useCallback(async (payload: Partial<AdminTask>) => {
    if (!user) return { error: "not-auth" as const };
    const row: any = {
      category: payload.category ?? "generico",
      title: payload.title ?? "Senza titolo",
      description: payload.description ?? null,
      status: payload.status ?? "da_fare",
      priority: payload.priority ?? "media",
      responsible_id: payload.responsible_id ?? null,
      assignee_ids: payload.assignee_ids ?? [],
      start_at: payload.start_at ?? null,
      due_at: payload.due_at ?? null,
      reminder_at: payload.reminder_at ?? null,
      checklist: payload.checklist ?? [],
      attachments: payload.attachments ?? [],
      linked_commessa_id: payload.linked_commessa_id ?? null,
      linked_contact_id: payload.linked_contact_id ?? null,
      linked_sub_project: payload.linked_sub_project ?? null,
      created_by: user.id,
    };
    const { data, error } = await supabase.from("admin_tasks" as any).insert(row).select().single();
    return { data: data as unknown as AdminTask | null, error };
  }, [user]);

  const update = useCallback(async (id: string, patch: Partial<AdminTask>) => {
    const { error } = await supabase.from("admin_tasks" as any).update(patch as any).eq("id", id);
    return { error };
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("admin_tasks" as any).delete().eq("id", id);
    return { error };
  }, []);

  return { tasks, loading, load, create, update, remove };
};
