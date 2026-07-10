export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_task_dependencies: {
        Row: {
          created_at: string
          depends_on_sub_order_id: string | null
          depends_on_task_id: string | null
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_sub_order_id?: string | null
          depends_on_task_id?: string | null
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_sub_order_id?: string | null
          depends_on_task_id?: string | null
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_task_dependencies_depends_on_sub_order_id_fkey"
            columns: ["depends_on_sub_order_id"]
            isOneToOne: false
            referencedRelation: "production_sub_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "admin_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "admin_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_tasks: {
        Row: {
          assignee_ids: string[]
          attachments: Json
          category: Database["public"]["Enums"]["admin_task_category"]
          checklist: Json
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          id: string
          linked_commessa_id: string | null
          linked_contact_id: string | null
          linked_sub_project: Json | null
          priority: Database["public"]["Enums"]["admin_task_priority"]
          reminder_at: string | null
          responsible_id: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["admin_task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_ids?: string[]
          attachments?: Json
          category: Database["public"]["Enums"]["admin_task_category"]
          checklist?: Json
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          linked_commessa_id?: string | null
          linked_contact_id?: string | null
          linked_sub_project?: Json | null
          priority?: Database["public"]["Enums"]["admin_task_priority"]
          reminder_at?: string | null
          responsible_id?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["admin_task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_ids?: string[]
          attachments?: Json
          category?: Database["public"]["Enums"]["admin_task_category"]
          checklist?: Json
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          linked_commessa_id?: string | null
          linked_contact_id?: string | null
          linked_sub_project?: Json | null
          priority?: Database["public"]["Enums"]["admin_task_priority"]
          reminder_at?: string | null
          responsible_id?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["admin_task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_tasks_linked_commessa_id_fkey"
            columns: ["linked_commessa_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_tasks_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      app_pages: {
        Row: {
          description: string | null
          key: string
          label: string
          ordine: number
        }
        Insert: {
          description?: string | null
          key: string
          label: string
          ordine?: number
        }
        Update: {
          description?: string | null
          key?: string
          label?: string
          ordine?: number
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          entity_id: string | null
          entity_type: string
          id: string
          new_state: Json | null
          prev_state: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          new_state?: Json | null
          prev_state?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_state?: Json | null
          prev_state?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      catalogs: {
        Row: {
          data: Json
          dept: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          data?: Json
          dept: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          data?: Json
          dept?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      commessa_assegnatari: {
        Row: {
          assigned_at: string
          commessa_id: string
          responsabile: boolean
          user_id: string
        }
        Insert: {
          assigned_at?: string
          commessa_id: string
          responsabile?: boolean
          user_id: string
        }
        Update: {
          assigned_at?: string
          commessa_id?: string
          responsabile?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commessa_assegnatari_commessa_id_fkey"
            columns: ["commessa_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id"]
          },
        ]
      }
      commessa_updates: {
        Row: {
          author_id: string
          body: string
          commessa_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          parent_id: string | null
          proposed_date: string | null
          status: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string
          commessa_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          parent_id?: string | null
          proposed_date?: string | null
          status?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          commessa_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          parent_id?: string | null
          proposed_date?: string | null
          status?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commessa_updates_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "commessa_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      commesse: {
        Row: {
          cliente: string | null
          created_at: string
          created_by: string
          data_scadenza: string | null
          descrizione: string | null
          id: string
          importo: number | null
          macro_reparto: string | null
          note: string | null
          operator_ids: string[]
          ordine: number
          priorita: Database["public"]["Enums"]["commessa_priorita"]
          reparto: Database["public"]["Enums"]["commessa_reparto"]
          responsabile_id: string | null
          snapshot: Json | null
          stato: Database["public"]["Enums"]["commessa_stato"]
          tipo: Database["public"]["Enums"]["commessa_tipo"]
          titolo: string
          updated_at: string
        }
        Insert: {
          cliente?: string | null
          created_at?: string
          created_by: string
          data_scadenza?: string | null
          descrizione?: string | null
          id?: string
          importo?: number | null
          macro_reparto?: string | null
          note?: string | null
          operator_ids?: string[]
          ordine?: number
          priorita?: Database["public"]["Enums"]["commessa_priorita"]
          reparto?: Database["public"]["Enums"]["commessa_reparto"]
          responsabile_id?: string | null
          snapshot?: Json | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          tipo?: Database["public"]["Enums"]["commessa_tipo"]
          titolo: string
          updated_at?: string
        }
        Update: {
          cliente?: string | null
          created_at?: string
          created_by?: string
          data_scadenza?: string | null
          descrizione?: string | null
          id?: string
          importo?: number | null
          macro_reparto?: string | null
          note?: string | null
          operator_ids?: string[]
          ordine?: number
          priorita?: Database["public"]["Enums"]["commessa_priorita"]
          reparto?: Database["public"]["Enums"]["commessa_reparto"]
          responsabile_id?: string | null
          snapshot?: Json | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          tipo?: Database["public"]["Enums"]["commessa_tipo"]
          titolo?: string
          updated_at?: string
        }
        Relationships: []
      }
      contabilita_state: {
        Row: {
          data: Json
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          data?: Json
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          data?: Json
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      contabilita_state_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          key: string
          movements_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          key: string
          movements_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          key?: string
          movements_count?: number
        }
        Relationships: []
      }
      design_draft_versions: {
        Row: {
          created_at: string
          draft_id: string
          id: string
          name: string
          snapshot: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          id?: string
          name?: string
          snapshot?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          id?: string
          name?: string
          snapshot?: Json
          user_id?: string
        }
        Relationships: []
      }
      design_drafts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          ordine: number
          snapshot: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          ordine?: number
          snapshot?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          ordine?: number
          snapshot?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dipendenti: {
        Row: {
          annual_hours: number
          attivo: boolean
          contract_hours_per_day: number
          created_at: string
          created_by: string
          email: string | null
          extra_costs: number
          funzione: string | null
          hourly_rate: number
          id: string
          inail_pct: number
          inps_pct: number
          macro_reparti: string[]
          nome: string
          note: string | null
          profile_id: string | null
          ral: number
          reparti: string[]
          telefono: string | null
          tfr_pct: number
          updated_at: string
        }
        Insert: {
          annual_hours?: number
          attivo?: boolean
          contract_hours_per_day?: number
          created_at?: string
          created_by: string
          email?: string | null
          extra_costs?: number
          funzione?: string | null
          hourly_rate?: number
          id?: string
          inail_pct?: number
          inps_pct?: number
          macro_reparti?: string[]
          nome: string
          note?: string | null
          profile_id?: string | null
          ral?: number
          reparti?: string[]
          telefono?: string | null
          tfr_pct?: number
          updated_at?: string
        }
        Update: {
          annual_hours?: number
          attivo?: boolean
          contract_hours_per_day?: number
          created_at?: string
          created_by?: string
          email?: string | null
          extra_costs?: number
          funzione?: string | null
          hourly_rate?: number
          id?: string
          inail_pct?: number
          inps_pct?: number
          macro_reparti?: string[]
          nome?: string
          note?: string | null
          profile_id?: string | null
          ral?: number
          reparti?: string[]
          telefono?: string | null
          tfr_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dipendenti_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          code: string
          created_at: string
          descrizione: string | null
          id: string
          kind: Database["public"]["Enums"]["inv_item_kind"]
          material_attrs: Json
          material_color: string | null
          material_height: string | null
          material_key: string | null
          material_name: string | null
          nome: string
          note: string | null
          posizione: string | null
          qty_intera: number
          qty_sfrido: number
          reparto: string
          soglia_minima: number
          um: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          descrizione?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["inv_item_kind"]
          material_attrs?: Json
          material_color?: string | null
          material_height?: string | null
          material_key?: string | null
          material_name?: string | null
          nome: string
          note?: string | null
          posizione?: string | null
          qty_intera?: number
          qty_sfrido?: number
          reparto?: string
          soglia_minima?: number
          um?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          descrizione?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["inv_item_kind"]
          material_attrs?: Json
          material_color?: string | null
          material_height?: string | null
          material_key?: string | null
          material_name?: string | null
          nome?: string
          note?: string | null
          posizione?: string | null
          qty_intera?: number
          qty_sfrido?: number
          reparto?: string
          soglia_minima?: number
          um?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_reservations: {
        Row: {
          created_at: string
          id: string
          item_id: string
          order_id: string
          qty: number
          reserved_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          order_id: string
          qty?: number
          reserved_by: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          order_id?: string
          qty?: number
          reserved_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_scrap_pieces: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          h_mm: number
          id: string
          inventory_id: string
          note: string | null
          posizione: string | null
          reserved_for_order: string | null
          reserved_for_sub: string | null
          status: Database["public"]["Enums"]["scrap_piece_status"]
          thickness_mm: number | null
          updated_at: string
          w_mm: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          h_mm: number
          id?: string
          inventory_id: string
          note?: string | null
          posizione?: string | null
          reserved_for_order?: string | null
          reserved_for_sub?: string | null
          status?: Database["public"]["Enums"]["scrap_piece_status"]
          thickness_mm?: number | null
          updated_at?: string
          w_mm: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          h_mm?: number
          id?: string
          inventory_id?: string
          note?: string | null
          posizione?: string | null
          reserved_for_order?: string | null
          reserved_for_sub?: string | null
          status?: Database["public"]["Enums"]["scrap_piece_status"]
          thickness_mm?: number | null
          updated_at?: string
          w_mm?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_scrap_pieces_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_activity_log: {
        Row: {
          channel: string
          created_at: string
          created_by: string
          detail: string | null
          id: string
          meta: Json
          recipients_count: number
          status: string
          title: string
          type: string
        }
        Insert: {
          channel: string
          created_at?: string
          created_by: string
          detail?: string | null
          id?: string
          meta?: Json
          recipients_count?: number
          status?: string
          title: string
          type: string
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string
          detail?: string | null
          id?: string
          meta?: Json
          recipients_count?: number
          status?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      marketing_categories: {
        Row: {
          color: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "marketing_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_contact_categories: {
        Row: {
          category_id: string
          contact_id: string
          created_at: string
        }
        Insert: {
          category_id: string
          contact_id: string
          created_at?: string
        }
        Update: {
          category_id?: string
          contact_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_contact_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "marketing_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contact_categories_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_contacts: {
        Row: {
          azienda: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          nome: string
          note: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          azienda?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          nome: string
          note?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          azienda?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          nome?: string
          note?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      marketing_newsletters: {
        Row: {
          attachments: Json
          blocks: Json
          category_ids: Json
          content_html: string
          created_at: string
          created_by: string
          from_email: string | null
          from_name: string | null
          id: string
          mailchimp_audience_id: string | null
          mailchimp_campaign_id: string | null
          preview_text: string | null
          recipients_count: number
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          blocks?: Json
          category_ids?: Json
          content_html?: string
          created_at?: string
          created_by: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          mailchimp_audience_id?: string | null
          mailchimp_campaign_id?: string | null
          preview_text?: string | null
          recipients_count?: number
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          blocks?: Json
          category_ids?: Json
          content_html?: string
          created_at?: string
          created_by?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          mailchimp_audience_id?: string | null
          mailchimp_campaign_id?: string | null
          preview_text?: string | null
          recipients_count?: number
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      material_dependencies: {
        Row: {
          consumer_dept: string | null
          created_at: string
          created_by: string | null
          id: string
          material_pattern: string
          mode: string
          note: string | null
          produced_by_dept: string
          updated_at: string
        }
        Insert: {
          consumer_dept?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          material_pattern: string
          mode?: string
          note?: string | null
          produced_by_dept: string
          updated_at?: string
        }
        Update: {
          consumer_dept?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          material_pattern?: string
          mode?: string
          note?: string | null
          produced_by_dept?: string
          updated_at?: string
        }
        Relationships: []
      }
      montaggi_assignment_items: {
        Row: {
          commessa_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          note: string | null
          qty: number
          ref_id: string | null
          ref_nome: string
          unita: string
          updated_at: string
        }
        Insert: {
          commessa_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: string
          note?: string | null
          qty?: number
          ref_id?: string | null
          ref_nome: string
          unita?: string
          updated_at?: string
        }
        Update: {
          commessa_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          note?: string | null
          qty?: number
          ref_id?: string | null
          ref_nome?: string
          unita?: string
          updated_at?: string
        }
        Relationships: []
      }
      montaggi_attrezzi: {
        Row: {
          categoria: string | null
          created_at: string
          created_by: string
          descrizione: string | null
          id: string
          nome: string
          note: string | null
          unita: string
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          created_by: string
          descrizione?: string | null
          id?: string
          nome: string
          note?: string | null
          unita?: string
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          created_at?: string
          created_by?: string
          descrizione?: string | null
          id?: string
          nome?: string
          note?: string | null
          unita?: string
          updated_at?: string
        }
        Relationships: []
      }
      montaggi_lavorazione_templates: {
        Row: {
          costo_orario_default: number
          created_at: string
          created_by: string
          descrizione: string | null
          id: string
          materiali: Json
          nome: string
          note: string | null
          ore_stimate: number
          updated_at: string
        }
        Insert: {
          costo_orario_default?: number
          created_at?: string
          created_by: string
          descrizione?: string | null
          id?: string
          materiali?: Json
          nome: string
          note?: string | null
          ore_stimate?: number
          updated_at?: string
        }
        Update: {
          costo_orario_default?: number
          created_at?: string
          created_by?: string
          descrizione?: string | null
          id?: string
          materiali?: Json
          nome?: string
          note?: string | null
          ore_stimate?: number
          updated_at?: string
        }
        Relationships: []
      }
      montaggi_lavorazioni: {
        Row: {
          causale: string
          costo_orario: number
          created_at: string
          created_by: string
          descrizione: string | null
          draft_id: string
          id: string
          note: string | null
          operatore_id: string | null
          operatore_ids: string[]
          ordine: number
          ore: number
          source_kind: string
          source_ref: Json | null
          stato: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          causale: string
          costo_orario?: number
          created_at?: string
          created_by: string
          descrizione?: string | null
          draft_id: string
          id?: string
          note?: string | null
          operatore_id?: string | null
          operatore_ids?: string[]
          ordine?: number
          ore?: number
          source_kind?: string
          source_ref?: Json | null
          stato?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          causale?: string
          costo_orario?: number
          created_at?: string
          created_by?: string
          descrizione?: string | null
          draft_id?: string
          id?: string
          note?: string | null
          operatore_id?: string | null
          operatore_ids?: string[]
          ordine?: number
          ore?: number
          source_kind?: string
          source_ref?: Json | null
          stato?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "montaggi_lavorazioni_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "montaggi_lavorazione_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      montaggi_materiali: {
        Row: {
          categoria: string | null
          created_at: string
          created_by: string
          descrizione: string | null
          id: string
          nome: string
          note: string | null
          unita: string
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          created_by: string
          descrizione?: string | null
          id?: string
          nome: string
          note?: string | null
          unita?: string
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          created_at?: string
          created_by?: string
          descrizione?: string | null
          id?: string
          nome?: string
          note?: string | null
          unita?: string
          updated_at?: string
        }
        Relationships: []
      }
      montaggi_planning: {
        Row: {
          cantiere_label: string
          commessa_id: string | null
          created_at: string
          created_by: string
          date: string
          end_time: string | null
          hours: number
          id: string
          notes: string | null
          operator_id: string
          reparto: string
          role: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          cantiere_label?: string
          commessa_id?: string | null
          created_at?: string
          created_by: string
          date: string
          end_time?: string | null
          hours?: number
          id?: string
          notes?: string | null
          operator_id: string
          reparto?: string
          role?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          cantiere_label?: string
          commessa_id?: string | null
          created_at?: string
          created_by?: string
          date?: string
          end_time?: string | null
          hours?: number
          id?: string
          notes?: string | null
          operator_id?: string
          reparto?: string
          role?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      personal_record_shares: {
        Row: {
          created_at: string
          read_at: string | null
          record_id: string
          shared_by: string
          shared_with: string
        }
        Insert: {
          created_at?: string
          read_at?: string | null
          record_id: string
          shared_by: string
          shared_with: string
        }
        Update: {
          created_at?: string
          read_at?: string | null
          record_id?: string
          shared_by?: string
          shared_with?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_record_shares_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "personal_records"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_records: {
        Row: {
          amount: number | null
          contact_kind: string
          contact_name: string
          created_at: string
          currency: string
          description: string | null
          due_date: string | null
          event_at: string | null
          id: string
          owner_id: string
          record_type: string
          status: string
          tags: string[]
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          amount?: number | null
          contact_kind?: string
          contact_name: string
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          event_at?: string | null
          id?: string
          owner_id: string
          record_type: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          amount?: number | null
          contact_kind?: string
          contact_name?: string
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          event_at?: string | null
          id?: string
          owner_id?: string
          record_type?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      prod_chat_channels: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["prod_chat_kind"]
          members: string[]
          name: string
          order_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["prod_chat_kind"]
          members?: string[]
          name: string
          order_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["prod_chat_kind"]
          members?: string[]
          name?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prod_chat_channels_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      prod_chat_messages: {
        Row: {
          attachments: Json
          body: string
          channel_id: string
          created_at: string
          id: string
          reactions: Json
          user_id: string
        }
        Insert: {
          attachments?: Json
          body: string
          channel_id: string
          created_at?: string
          id?: string
          reactions?: Json
          user_id: string
        }
        Update: {
          attachments?: Json
          body?: string
          channel_id?: string
          created_at?: string
          id?: string
          reactions?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prod_chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "prod_chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      prod_notifications: {
        Row: {
          created_at: string
          id: string
          is_urgent: boolean
          link: string | null
          message: string
          order_id: string | null
          read_at: string | null
          type: Database["public"]["Enums"]["prod_notif_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_urgent?: boolean
          link?: string | null
          message: string
          order_id?: string | null
          read_at?: string | null
          type: Database["public"]["Enums"]["prod_notif_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_urgent?: boolean
          link?: string | null
          message?: string
          order_id?: string | null
          read_at?: string | null
          type?: Database["public"]["Enums"]["prod_notif_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prod_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          attachments: Json
          cliente: string
          code: string
          coordinator_id: string | null
          corriere: string | null
          created_at: string
          created_by: string
          customer_order_ref: string | null
          data: string
          ddt_causale: string | null
          ddt_date: string | null
          ddt_note: string | null
          ddt_number: string | null
          delivery: Database["public"]["Enums"]["prod_delivery"]
          id: string
          nesting_included: boolean
          note: string | null
          priorita: Database["public"]["Enums"]["prod_priority"]
          production_name: string | null
          snapshot: Json | null
          source_commessa_id: string | null
          spedizione_at: string | null
          status: Database["public"]["Enums"]["prod_order_status"]
          updated_at: string
        }
        Insert: {
          attachments?: Json
          cliente: string
          code: string
          coordinator_id?: string | null
          corriere?: string | null
          created_at?: string
          created_by: string
          customer_order_ref?: string | null
          data?: string
          ddt_causale?: string | null
          ddt_date?: string | null
          ddt_note?: string | null
          ddt_number?: string | null
          delivery?: Database["public"]["Enums"]["prod_delivery"]
          id?: string
          nesting_included?: boolean
          note?: string | null
          priorita?: Database["public"]["Enums"]["prod_priority"]
          production_name?: string | null
          snapshot?: Json | null
          source_commessa_id?: string | null
          spedizione_at?: string | null
          status?: Database["public"]["Enums"]["prod_order_status"]
          updated_at?: string
        }
        Update: {
          attachments?: Json
          cliente?: string
          code?: string
          coordinator_id?: string | null
          corriere?: string | null
          created_at?: string
          created_by?: string
          customer_order_ref?: string | null
          data?: string
          ddt_causale?: string | null
          ddt_date?: string | null
          ddt_note?: string | null
          ddt_number?: string | null
          delivery?: Database["public"]["Enums"]["prod_delivery"]
          id?: string
          nesting_included?: boolean
          note?: string | null
          priorita?: Database["public"]["Enums"]["prod_priority"]
          production_name?: string | null
          snapshot?: Json | null
          source_commessa_id?: string | null
          spedizione_at?: string | null
          status?: Database["public"]["Enums"]["prod_order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_sub_checklist: {
        Row: {
          created_at: string
          done_at: string | null
          done_by: string | null
          id: string
          label: string
          note: string | null
          ordine: number
          status: Database["public"]["Enums"]["checklist_item_status"]
          sub_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          label: string
          note?: string | null
          ordine?: number
          status?: Database["public"]["Enums"]["checklist_item_status"]
          sub_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          label?: string
          note?: string | null
          ordine?: number
          status?: Database["public"]["Enums"]["checklist_item_status"]
          sub_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_sub_checklist_sub_id_fkey"
            columns: ["sub_id"]
            isOneToOne: false
            referencedRelation: "production_sub_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      production_sub_orders: {
        Row: {
          assignee_id: string | null
          code: string
          completed_at: string | null
          coordinator_id: string | null
          created_at: string
          depends_on: string | null
          depends_on_task_id: string | null
          dept: Database["public"]["Enums"]["prod_dept"]
          due_date: string | null
          end_date: string | null
          files: Json
          id: string
          macro_reparto: string | null
          material_code: string | null
          material_label: string | null
          material_qty: number | null
          material_unit: string | null
          note: string | null
          operator_ids: string[]
          order_id: string
          order_status: string | null
          ordine: number
          rejected_at: string | null
          rejected_by: string | null
          rejected_to: string | null
          rejection_reason: string | null
          start_date: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["prod_sub_status"]
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          code: string
          completed_at?: string | null
          coordinator_id?: string | null
          created_at?: string
          depends_on?: string | null
          depends_on_task_id?: string | null
          dept: Database["public"]["Enums"]["prod_dept"]
          due_date?: string | null
          end_date?: string | null
          files?: Json
          id?: string
          macro_reparto?: string | null
          material_code?: string | null
          material_label?: string | null
          material_qty?: number | null
          material_unit?: string | null
          note?: string | null
          operator_ids?: string[]
          order_id: string
          order_status?: string | null
          ordine?: number
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_to?: string | null
          rejection_reason?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["prod_sub_status"]
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          code?: string
          completed_at?: string | null
          coordinator_id?: string | null
          created_at?: string
          depends_on?: string | null
          depends_on_task_id?: string | null
          dept?: Database["public"]["Enums"]["prod_dept"]
          due_date?: string | null
          end_date?: string | null
          files?: Json
          id?: string
          macro_reparto?: string | null
          material_code?: string | null
          material_label?: string | null
          material_qty?: number | null
          material_unit?: string | null
          note?: string | null
          operator_ids?: string[]
          order_id?: string
          order_status?: string | null
          ordine?: number
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_to?: string | null
          rejection_reason?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["prod_sub_status"]
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_sub_orders_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sub_orders_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "production_sub_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sub_orders_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "admin_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sub_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          settori: Database["public"]["Enums"]["app_settore"][]
          updated_at: string
        }
        Insert: {
          approved?: boolean
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          settori?: Database["public"]["Enums"]["app_settore"][]
          updated_at?: string
        }
        Update: {
          approved?: boolean
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          settori?: Database["public"]["Enums"]["app_settore"][]
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reparti_config: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key: string
          kind: string
          label: string
          macro_key: string | null
          ordine: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          kind: string
          label: string
          macro_key?: string | null
          ordine?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          kind?: string
          label?: string
          macro_key?: string | null
          ordine?: number
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          created_at: string
          id: string
          level: Database["public"]["Enums"]["permission_level"]
          page_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["permission_level"]
          page_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["permission_level"]
          page_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_page_key_fkey"
            columns: ["page_key"]
            isOneToOne: false
            referencedRelation: "app_pages"
            referencedColumns: ["key"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_workspaces: {
        Row: {
          created_at: string
          data: Json
          key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_users: {
        Args: never
        Returns: {
          approved: boolean
          created_at: string
          display_name: string
          email: string
          id: string
          roles: string[]
        }[]
      }
      admin_set_user_permission: {
        Args: {
          _level: Database["public"]["Enums"]["permission_level"]
          _page: string
          _user_id: string
        }
        Returns: undefined
      }
      admin_set_user_roles: {
        Args: { _roles: string[]; _user_id: string }
        Returns: undefined
      }
      admin_task_permission_key: {
        Args: { _cat: Database["public"]["Enums"]["admin_task_category"] }
        Returns: string
      }
      can_view_admin_task: {
        Args: { _task_id: string; _user: string }
        Returns: boolean
      }
      can_view_order: {
        Args: { _order_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_sub_order: {
        Args: { _sub_id: string; _user_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_admin_user_ids: { Args: never; Returns: string[] }
      has_permission: {
        Args: {
          _page: string
          _required: Database["public"]["Enums"]["permission_level"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_coordinator: {
        Args: { _sub_id: string; _user_id: string }
        Returns: boolean
      }
      is_record_owner: { Args: { _record_id: string }; Returns: boolean }
      is_record_shared_with_me: {
        Args: { _record_id: string }
        Returns: boolean
      }
      log_audit_action: {
        Args: {
          _action: string
          _detail?: string
          _entity_id?: string
          _entity_type: string
          _new_state?: Json
          _prev_state?: Json
        }
        Returns: string
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_production_order_code: { Args: never; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      return_order_to_revision: {
        Args: { _order_id: string; _reason: string; _sub_order_id: string }
        Returns: string
      }
    }
    Enums: {
      admin_task_category:
        | "amministrazione"
        | "acquisti"
        | "vendite"
        | "marketing"
        | "hr"
        | "generico"
      admin_task_priority: "bassa" | "media" | "alta" | "urgente"
      admin_task_status:
        | "da_fare"
        | "in_corso"
        | "in_attesa"
        | "bloccato"
        | "completato"
        | "annullato"
      app_role:
        | "admin"
        | "member"
        | "contabilita"
        | "produzione"
        | "commerciale"
        | "magazzino"
        | "coordinatore"
      app_settore:
        | "grafica"
        | "stampa"
        | "taglio"
        | "tappezzeria"
        | "stampa_3d"
        | "falegnameria"
        | "altro"
        | "amministrazione"
        | "logistica"
        | "magazzino"
        | "acquisti"
        | "laboratorio"
        | "vendite"
        | "progettazione"
        | "montaggi"
      checklist_item_status: "todo" | "done" | "skipped"
      commessa_priorita: "bassa" | "media" | "alta"
      commessa_reparto:
        | "tappezzeria"
        | "stampa"
        | "falegnameria"
        | "generale"
        | "amministrazione"
        | "logistica"
        | "acquisti"
        | "progettazione"
        | "vendite"
        | "lavorazione"
        | "montaggi"
      commessa_stato:
        | "da_fare"
        | "preventivo"
        | "in_produzione"
        | "pronto"
        | "consegnato"
      commessa_tipo: "commessa" | "task"
      inv_item_kind: "nuovo" | "sfrido"
      permission_level: "none" | "read" | "write"
      prod_chat_kind: "generale" | "ordine" | "diretto"
      prod_delivery: "spedizione" | "ritiro" | "mezzo_proprio" | "corriere"
      prod_dept:
        | "taglio"
        | "stampa"
        | "tappezzeria"
        | "assemblaggio"
        | "altro"
        | "grafica"
        | "stampa_3d"
        | "falegnameria"
        | "magazzino"
        | "acquisti"
        | "laboratorio"
        | "vendite"
        | "progettazione"
        | "lavorazione"
        | "montaggi"
      prod_notif_type:
        | "ordine_creato"
        | "subordine_assegnato"
        | "subordine_completato"
        | "ordine_pronto"
        | "ordine_chiuso"
        | "stock_basso"
        | "chat_messaggio"
        | "priorita_cambiata"
        | "subordine_rimandato"
        | "ordine_rimandato"
        | "magazzino_da_preparare"
        | "sub_sbloccato"
      prod_order_status:
        | "nuovo"
        | "in_corso"
        | "pronto"
        | "spedito"
        | "chiuso"
        | "annullato"
      prod_priority: "normale" | "urgente" | "bloccante"
      prod_sub_status:
        | "in_attesa"
        | "in_lavorazione"
        | "completato"
        | "bloccato"
        | "rimandato"
      scrap_piece_status: "libero" | "riservato" | "usato"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      admin_task_category: [
        "amministrazione",
        "acquisti",
        "vendite",
        "marketing",
        "hr",
        "generico",
      ],
      admin_task_priority: ["bassa", "media", "alta", "urgente"],
      admin_task_status: [
        "da_fare",
        "in_corso",
        "in_attesa",
        "bloccato",
        "completato",
        "annullato",
      ],
      app_role: [
        "admin",
        "member",
        "contabilita",
        "produzione",
        "commerciale",
        "magazzino",
        "coordinatore",
      ],
      app_settore: [
        "grafica",
        "stampa",
        "taglio",
        "tappezzeria",
        "stampa_3d",
        "falegnameria",
        "altro",
        "amministrazione",
        "logistica",
        "magazzino",
        "acquisti",
        "laboratorio",
        "vendite",
        "progettazione",
        "montaggi",
      ],
      checklist_item_status: ["todo", "done", "skipped"],
      commessa_priorita: ["bassa", "media", "alta"],
      commessa_reparto: [
        "tappezzeria",
        "stampa",
        "falegnameria",
        "generale",
        "amministrazione",
        "logistica",
        "acquisti",
        "progettazione",
        "vendite",
        "lavorazione",
        "montaggi",
      ],
      commessa_stato: [
        "da_fare",
        "preventivo",
        "in_produzione",
        "pronto",
        "consegnato",
      ],
      commessa_tipo: ["commessa", "task"],
      inv_item_kind: ["nuovo", "sfrido"],
      permission_level: ["none", "read", "write"],
      prod_chat_kind: ["generale", "ordine", "diretto"],
      prod_delivery: ["spedizione", "ritiro", "mezzo_proprio", "corriere"],
      prod_dept: [
        "taglio",
        "stampa",
        "tappezzeria",
        "assemblaggio",
        "altro",
        "grafica",
        "stampa_3d",
        "falegnameria",
        "magazzino",
        "acquisti",
        "laboratorio",
        "vendite",
        "progettazione",
        "lavorazione",
        "montaggi",
      ],
      prod_notif_type: [
        "ordine_creato",
        "subordine_assegnato",
        "subordine_completato",
        "ordine_pronto",
        "ordine_chiuso",
        "stock_basso",
        "chat_messaggio",
        "priorita_cambiata",
        "subordine_rimandato",
        "ordine_rimandato",
        "magazzino_da_preparare",
        "sub_sbloccato",
      ],
      prod_order_status: [
        "nuovo",
        "in_corso",
        "pronto",
        "spedito",
        "chiuso",
        "annullato",
      ],
      prod_priority: ["normale", "urgente", "bloccante"],
      prod_sub_status: [
        "in_attesa",
        "in_lavorazione",
        "completato",
        "bloccato",
        "rimandato",
      ],
      scrap_piece_status: ["libero", "riservato", "usato"],
    },
  },
} as const
