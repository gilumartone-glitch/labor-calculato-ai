import { supabase } from "@/integrations/supabase/client";
import type { PersonalRecord, RecordShare } from "./types";

export async function listRecords(): Promise<PersonalRecord[]> {
  const { data, error } = await supabase
    .from("personal_records")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PersonalRecord[];
}

export async function listSharesForRecords(recordIds: string[]): Promise<RecordShare[]> {
  if (recordIds.length === 0) return [];
  const { data, error } = await supabase
    .from("personal_record_shares")
    .select("*")
    .in("record_id", recordIds);
  if (error) throw error;
  return (data ?? []) as RecordShare[];
}

export async function createRecord(payload: Omit<PersonalRecord, "id" | "created_at" | "updated_at">) {
  const { data, error } = await supabase.from("personal_records").insert(payload).select().single();
  if (error) throw error;
  return data as PersonalRecord;
}

export async function updateRecord(id: string, patch: Partial<PersonalRecord>) {
  const { data, error } = await supabase.from("personal_records").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data as PersonalRecord;
}

export async function deleteRecord(id: string) {
  const { error } = await supabase.from("personal_records").delete().eq("id", id);
  if (error) throw error;
}

export async function shareRecord(record_id: string, shared_with: string, shared_by: string) {
  const { error } = await supabase
    .from("personal_record_shares")
    .insert({ record_id, shared_with, shared_by });
  if (error) throw error;
}

export async function unshareRecord(record_id: string, shared_with: string) {
  const { error } = await supabase
    .from("personal_record_shares")
    .delete()
    .eq("record_id", record_id)
    .eq("shared_with", shared_with);
  if (error) throw error;
}

export async function markShareRead(record_id: string) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return;
  await supabase
    .from("personal_record_shares")
    .update({ read_at: new Date().toISOString() })
    .eq("record_id", record_id)
    .eq("shared_with", uid)
    .is("read_at", null);
}

export type UserLite = { id: string; display_name: string | null };

export async function listProfiles(): Promise<UserLite[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("approved", true)
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as UserLite[];
}
