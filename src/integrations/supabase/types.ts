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
      bank_accounts: {
        Row: {
          account_ref: string
          balance: number | null
          balance_date: string | null
          bank: string
          connection_id: string | null
          currency: string
          display_name: string
          iban_last4: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          needs_reconnect: boolean
        }
        Insert: {
          account_ref: string
          balance?: number | null
          balance_date?: string | null
          bank: string
          connection_id?: string | null
          currency?: string
          display_name: string
          iban_last4?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          needs_reconnect?: boolean
        }
        Update: {
          account_ref?: string
          balance?: number | null
          balance_date?: string | null
          bank?: string
          connection_id?: string | null
          currency?: string
          display_name?: string
          iban_last4?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          needs_reconnect?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bank_provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_allocations: {
        Row: {
          accounting_key: string
          amount: number
          cash_movement_id: string
          competence_id: string | null
          created_at: string
          created_by: string
          id: string
          transaction_id: string
        }
        Insert: {
          accounting_key: string
          amount: number
          cash_movement_id: string
          competence_id?: string | null
          created_at?: string
          created_by: string
          id: string
          transaction_id: string
        }
        Update: {
          accounting_key?: string
          amount?: number
          cash_movement_id?: string
          competence_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_allocations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_obio_runtime: {
        Row: {
          id: boolean
          lock_until: string | null
          run_id: string | null
        }
        Insert: {
          id?: boolean
          lock_until?: string | null
          run_id?: string | null
        }
        Update: {
          id?: boolean
          lock_until?: string | null
          run_id?: string | null
        }
        Relationships: []
      }
      bank_provider_connections: {
        Row: {
          accounts: Json
          bank: string
          consent_expires_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          session_id: string | null
          state: string
          status: string
          sync_lock_until: string | null
          user_id: string
        }
        Insert: {
          accounts?: Json
          bank: string
          consent_expires_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          session_id?: string | null
          state?: string
          status?: string
          sync_lock_until?: string | null
          user_id: string
        }
        Update: {
          accounts?: Json
          bank?: string
          consent_expires_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          session_id?: string | null
          state?: string
          status?: string
          sync_lock_until?: string | null
          user_id?: string
        }
        Relationships: []
      }
      bank_provider_settings: {
        Row: {
          commercial_evidence: string | null
          costs_verified: boolean
          id: boolean
          monthly_cost_eur: number | null
          provider: string
          sync_enabled: boolean
          verified_at: string | null
        }
        Insert: {
          commercial_evidence?: string | null
          costs_verified?: boolean
          id?: boolean
          monthly_cost_eur?: number | null
          provider?: string
          sync_enabled?: boolean
          verified_at?: string | null
        }
        Update: {
          commercial_evidence?: string | null
          costs_verified?: boolean
          id?: boolean
          monthly_cost_eur?: number | null
          provider?: string
          sync_enabled?: boolean
          verified_at?: string | null
        }
        Relationships: []
      }
      bank_schedule_config: {
        Row: {
          enabled: boolean
          endpoint: string
          id: boolean
          job_id: number | null
          last_dispatched_slot: string | null
          token: string
        }
        Insert: {
          enabled?: boolean
          endpoint: string
          id?: boolean
          job_id?: number | null
          last_dispatched_slot?: string | null
          token: string
        }
        Update: {
          enabled?: boolean
          endpoint?: string
          id?: boolean
          job_id?: number | null
          last_dispatched_slot?: string | null
          token?: string
        }
        Relationships: []
      }
      bank_sync_log: {
        Row: {
          account_id: string | null
          bank: string
          created_at: string
          id: string
          message: string
          outcome: string
        }
        Insert: {
          account_id?: string | null
          bank: string
          created_at?: string
          id?: string
          message: string
          outcome: string
        }
        Update: {
          account_id?: string | null
          bank?: string
          created_at?: string
          id?: string
          message?: string
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_sync_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account_id: string | null
          account_ref: string
          amount: number
          bank: string
          booking_date: string
          counterparty_name: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          external_id: string
          fingerprint: string | null
          id: string
          manual_updated_at: string | null
          reference_key: string | null
          source: string
          status: string
          updated_at: string
          value_date: string | null
        }
        Insert: {
          account_id?: string | null
          account_ref: string
          amount: number
          bank: string
          booking_date: string
          counterparty_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description: string
          external_id: string
          fingerprint?: string | null
          id?: string
          manual_updated_at?: string | null
          reference_key?: string | null
          source?: string
          status?: string
          updated_at?: string
          value_date?: string | null
        }
        Update: {
          account_id?: string | null
          account_ref?: string
          amount?: number
          bank?: string
          booking_date?: string
          counterparty_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string
          external_id?: string
          fingerprint?: string | null
          id?: string
          manual_updated_at?: string | null
          reference_key?: string | null
          source?: string
          status?: string
          updated_at?: string
          value_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
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
          pp_ordine: string | null
          pp_preventivo: string | null
          priorita: Database["public"]["Enums"]["commessa_priorita"]
          reparto: Database["public"]["Enums"]["commessa_reparto"]
          responsabile_id: string | null
          snapshot: Json | null
          source_draft_id: string | null
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
          pp_ordine?: string | null
          pp_preventivo?: string | null
          priorita?: Database["public"]["Enums"]["commessa_priorita"]
          reparto?: Database["public"]["Enums"]["commessa_reparto"]
          responsabile_id?: string | null
          snapshot?: Json | null
          source_draft_id?: string | null
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
          pp_ordine?: string | null
          pp_preventivo?: string | null
          priorita?: Database["public"]["Enums"]["commessa_priorita"]
          reparto?: Database["public"]["Enums"]["commessa_reparto"]
          responsabile_id?: string | null
          snapshot?: Json | null
          source_draft_id?: string | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          tipo?: Database["public"]["Enums"]["commessa_tipo"]
          titolo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commesse_source_draft_id_fkey"
            columns: ["source_draft_id"]
            isOneToOne: false
            referencedRelation: "design_drafts"
            referencedColumns: ["id"]
          },
        ]
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
      design_draft_shares: {
        Row: {
          created_at: string
          created_by: string
          draft_id: string
          id: string
          shared_with: string
        }
        Insert: {
          created_at?: string
          created_by: string
          draft_id: string
          id?: string
          shared_with: string
        }
        Update: {
          created_at?: string
          created_by?: string
          draft_id?: string
          id?: string
          shared_with?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_draft_shares_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "design_drafts"
            referencedColumns: ["id"]
          },
        ]
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
          archived_at: string | null
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
          archived_at?: string | null
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
          archived_at?: string | null
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
          rate_history: Json
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
          rate_history?: Json
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
          rate_history?: Json
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
      gest_aliquote_iva: {
        Row: {
          archiviato_il: string | null
          codice: string
          created_at: string
          descrizione: string
          id: string
          natura: string | null
          percentuale: number
          updated_at: string
          valido_al: string | null
          valido_dal: string | null
        }
        Insert: {
          archiviato_il?: string | null
          codice: string
          created_at?: string
          descrizione: string
          id?: string
          natura?: string | null
          percentuale: number
          updated_at?: string
          valido_al?: string | null
          valido_dal?: string | null
        }
        Update: {
          archiviato_il?: string | null
          codice?: string
          created_at?: string
          descrizione?: string
          id?: string
          natura?: string | null
          percentuale?: number
          updated_at?: string
          valido_al?: string | null
          valido_dal?: string | null
        }
        Relationships: []
      }
      gest_anagrafiche: {
        Row: {
          abi: string | null
          archiviato_il: string | null
          banca_appoggio: string | null
          banca_presentazione: string | null
          cab: string | null
          cap: string | null
          citta: string | null
          codice: string
          codice_fiscale: string | null
          codice_iva_esenzione: string | null
          codice_mexal: string | null
          codice_pagamento: string | null
          codice_sdi: string | null
          condizione_pagamento_id: string | null
          created_at: string
          dati_origine: Json | null
          email: string | null
          esigibilita_iva: string
          fido: number | null
          id: string
          importato_il: string | null
          indirizzo: string | null
          is_cliente: boolean
          is_fornitore: boolean
          nazione: string
          note: string | null
          ordine_cliente_tipo: string | null
          origine: string | null
          pagamento: string | null
          partita_iva: string | null
          pec: string | null
          provincia: string | null
          ragione_sociale: string
          senza_partita_iva: boolean
          telefono: string | null
          updated_at: string
        }
        Insert: {
          abi?: string | null
          archiviato_il?: string | null
          banca_appoggio?: string | null
          banca_presentazione?: string | null
          cab?: string | null
          cap?: string | null
          citta?: string | null
          codice: string
          codice_fiscale?: string | null
          codice_iva_esenzione?: string | null
          codice_mexal?: string | null
          codice_pagamento?: string | null
          codice_sdi?: string | null
          condizione_pagamento_id?: string | null
          created_at?: string
          dati_origine?: Json | null
          email?: string | null
          esigibilita_iva?: string
          fido?: number | null
          id?: string
          importato_il?: string | null
          indirizzo?: string | null
          is_cliente?: boolean
          is_fornitore?: boolean
          nazione?: string
          note?: string | null
          ordine_cliente_tipo?: string | null
          origine?: string | null
          pagamento?: string | null
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale: string
          senza_partita_iva?: boolean
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          abi?: string | null
          archiviato_il?: string | null
          banca_appoggio?: string | null
          banca_presentazione?: string | null
          cab?: string | null
          cap?: string | null
          citta?: string | null
          codice?: string
          codice_fiscale?: string | null
          codice_iva_esenzione?: string | null
          codice_mexal?: string | null
          codice_pagamento?: string | null
          codice_sdi?: string | null
          condizione_pagamento_id?: string | null
          created_at?: string
          dati_origine?: Json | null
          email?: string | null
          esigibilita_iva?: string
          fido?: number | null
          id?: string
          importato_il?: string | null
          indirizzo?: string | null
          is_cliente?: boolean
          is_fornitore?: boolean
          nazione?: string
          note?: string | null
          ordine_cliente_tipo?: string | null
          origine?: string | null
          pagamento?: string | null
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale?: string
          senza_partita_iva?: boolean
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_anagrafiche_condizione_pagamento_id_fkey"
            columns: ["condizione_pagamento_id"]
            isOneToOne: false
            referencedRelation: "gest_condizioni_pagamento"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_articoli: {
        Row: {
          archiviato_il: string | null
          categoria: string
          codice: string
          created_at: string
          id: string
          nome: string
          note: string | null
          um: string
          updated_at: string
        }
        Insert: {
          archiviato_il?: string | null
          categoria: string
          codice: string
          created_at?: string
          id?: string
          nome: string
          note?: string | null
          um: string
          updated_at?: string
        }
        Update: {
          archiviato_il?: string | null
          categoria?: string
          codice?: string
          created_at?: string
          id?: string
          nome?: string
          note?: string | null
          um?: string
          updated_at?: string
        }
        Relationships: []
      }
      gest_bagni: {
        Row: {
          archiviato_il: string | null
          codice_bagno: string
          created_at: string
          data_arrivo: string | null
          fornitore: string | null
          id: string
          note: string | null
          updated_at: string
          variante_id: string
        }
        Insert: {
          archiviato_il?: string | null
          codice_bagno: string
          created_at?: string
          data_arrivo?: string | null
          fornitore?: string | null
          id?: string
          note?: string | null
          updated_at?: string
          variante_id: string
        }
        Update: {
          archiviato_il?: string | null
          codice_bagno?: string
          created_at?: string
          data_arrivo?: string | null
          fornitore?: string | null
          id?: string
          note?: string | null
          updated_at?: string
          variante_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_bagni_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_bagni_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_condizioni_pagamento: {
        Row: {
          archiviato_il: string | null
          codice: string
          created_at: string
          descrizione: string
          fine_mese: boolean
          id: string
          modalita: string | null
          rate: Json
          updated_at: string
        }
        Insert: {
          archiviato_il?: string | null
          codice: string
          created_at?: string
          descrizione: string
          fine_mese?: boolean
          id?: string
          modalita?: string | null
          rate?: Json
          updated_at?: string
        }
        Update: {
          archiviato_il?: string | null
          codice?: string
          created_at?: string
          descrizione?: string
          fine_mese?: boolean
          id?: string
          modalita?: string | null
          rate?: Json
          updated_at?: string
        }
        Relationships: []
      }
      gest_documenti: {
        Row: {
          accompagnatoria: boolean
          anagrafica_id: string | null
          anno: number | null
          annullato_il: string | null
          aspetto_beni: string | null
          bollo_virtuale: boolean
          causale_trasporto: string | null
          cig: string | null
          colli: number | null
          condizione_pagamento_id: string | null
          confermato_da: string | null
          confermato_il: string | null
          consegna_prevista: string | null
          created_at: string
          creato_da: string | null
          cup: string | null
          data: string
          data_esterna: string | null
          design_draft_id: string | null
          destinazione: string | null
          esigibilita_iva: string
          id: string
          impegno_chiuso_il: string | null
          imponibile: number
          imposta: number
          intestatario: Json | null
          motivo_annullamento: string | null
          note: string | null
          note_interne: string | null
          numero: number | null
          oggetto: string | null
          ordine_cliente_tipo: string | null
          origine_id: string | null
          pagamento: string | null
          peso_kg: number | null
          porto: string | null
          produzione: string | null
          riferimento_esterno: string | null
          serie: string
          stato: string
          tipo: string
          totale: number
          updated_at: string
          validita_giorni: number | null
          vettore: string | null
        }
        Insert: {
          accompagnatoria?: boolean
          anagrafica_id?: string | null
          anno?: number | null
          annullato_il?: string | null
          aspetto_beni?: string | null
          bollo_virtuale?: boolean
          causale_trasporto?: string | null
          cig?: string | null
          colli?: number | null
          condizione_pagamento_id?: string | null
          confermato_da?: string | null
          confermato_il?: string | null
          consegna_prevista?: string | null
          created_at?: string
          creato_da?: string | null
          cup?: string | null
          data?: string
          data_esterna?: string | null
          design_draft_id?: string | null
          destinazione?: string | null
          esigibilita_iva?: string
          id?: string
          impegno_chiuso_il?: string | null
          imponibile?: number
          imposta?: number
          intestatario?: Json | null
          motivo_annullamento?: string | null
          note?: string | null
          note_interne?: string | null
          numero?: number | null
          oggetto?: string | null
          ordine_cliente_tipo?: string | null
          origine_id?: string | null
          pagamento?: string | null
          peso_kg?: number | null
          porto?: string | null
          produzione?: string | null
          riferimento_esterno?: string | null
          serie?: string
          stato?: string
          tipo: string
          totale?: number
          updated_at?: string
          validita_giorni?: number | null
          vettore?: string | null
        }
        Update: {
          accompagnatoria?: boolean
          anagrafica_id?: string | null
          anno?: number | null
          annullato_il?: string | null
          aspetto_beni?: string | null
          bollo_virtuale?: boolean
          causale_trasporto?: string | null
          cig?: string | null
          colli?: number | null
          condizione_pagamento_id?: string | null
          confermato_da?: string | null
          confermato_il?: string | null
          consegna_prevista?: string | null
          created_at?: string
          creato_da?: string | null
          cup?: string | null
          data?: string
          data_esterna?: string | null
          design_draft_id?: string | null
          destinazione?: string | null
          esigibilita_iva?: string
          id?: string
          impegno_chiuso_il?: string | null
          imponibile?: number
          imposta?: number
          intestatario?: Json | null
          motivo_annullamento?: string | null
          note?: string | null
          note_interne?: string | null
          numero?: number | null
          oggetto?: string | null
          ordine_cliente_tipo?: string | null
          origine_id?: string | null
          pagamento?: string | null
          peso_kg?: number | null
          porto?: string | null
          produzione?: string | null
          riferimento_esterno?: string | null
          serie?: string
          stato?: string
          tipo?: string
          totale?: number
          updated_at?: string
          validita_giorni?: number | null
          vettore?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_documenti_anagrafica_id_fkey"
            columns: ["anagrafica_id"]
            isOneToOne: false
            referencedRelation: "gest_anagrafiche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_condizione_pagamento_id_fkey"
            columns: ["condizione_pagamento_id"]
            isOneToOne: false
            referencedRelation: "gest_condizioni_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_origine_id_fkey"
            columns: ["origine_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_documenti_righe: {
        Row: {
          aliquota_id: string | null
          codice: string | null
          created_at: string
          descrizione: string
          dettagli: string | null
          documento_id: string
          id: string
          importo: number
          posizione: number
          prezzo_unitario: number
          quantita: number
          riga_origine_id: string | null
          sconto_pct: number
          tipo_riga: string
          um: string | null
          updated_at: string
          variante_id: string | null
        }
        Insert: {
          aliquota_id?: string | null
          codice?: string | null
          created_at?: string
          descrizione: string
          dettagli?: string | null
          documento_id: string
          id?: string
          importo?: number
          posizione?: number
          prezzo_unitario?: number
          quantita?: number
          riga_origine_id?: string | null
          sconto_pct?: number
          tipo_riga?: string
          um?: string | null
          updated_at?: string
          variante_id?: string | null
        }
        Update: {
          aliquota_id?: string | null
          codice?: string | null
          created_at?: string
          descrizione?: string
          dettagli?: string | null
          documento_id?: string
          id?: string
          importo?: number
          posizione?: number
          prezzo_unitario?: number
          quantita?: number
          riga_origine_id?: string | null
          sconto_pct?: number
          tipo_riga?: string
          um?: string | null
          updated_at?: string
          variante_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_documenti_righe_aliquota_id_fkey"
            columns: ["aliquota_id"]
            isOneToOne: false
            referencedRelation: "gest_aliquote_iva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_aliquota_id_fkey"
            columns: ["aliquota_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti_iva"
            referencedColumns: ["aliquota_id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_documenti_righe_pezze: {
        Row: {
          codice_bagno: string | null
          created_at: string
          id: string
          metri: number
          ordine: number
          pezza_id: string | null
          posizione: string | null
          riga_id: string
        }
        Insert: {
          codice_bagno?: string | null
          created_at?: string
          id?: string
          metri: number
          ordine?: number
          pezza_id?: string | null
          posizione?: string | null
          riga_id: string
        }
        Update: {
          codice_bagno?: string | null
          created_at?: string
          id?: string
          metri?: number
          ordine?: number
          pezza_id?: string | null
          posizione?: string | null
          riga_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_documenti_righe_pezze_pezza_id_fkey"
            columns: ["pezza_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_pezze"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_pezze_pezza_id_fkey"
            columns: ["pezza_id"]
            isOneToOne: false
            referencedRelation: "gest_pezze"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_pezze_riga_id_fkey"
            columns: ["riga_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti_righe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_pezze_riga_id_fkey"
            columns: ["riga_id"]
            isOneToOne: false
            referencedRelation: "gest_impegni"
            referencedColumns: ["riga_id"]
          },
        ]
      }
      gest_email_inviate: {
        Row: {
          allegato_nome: string | null
          anagrafica_id: string | null
          contesto: string
          copia: string[]
          creato_il: string
          destinatari: string[]
          documento_id: string | null
          errore: string | null
          esito: string
          id: number
          inviata_da: string | null
          message_id: string | null
          mittente: string
          oggetto: string
          testo: string
        }
        Insert: {
          allegato_nome?: string | null
          anagrafica_id?: string | null
          contesto: string
          copia?: string[]
          creato_il?: string
          destinatari: string[]
          documento_id?: string | null
          errore?: string | null
          esito: string
          id?: never
          inviata_da?: string | null
          message_id?: string | null
          mittente: string
          oggetto: string
          testo: string
        }
        Update: {
          allegato_nome?: string | null
          anagrafica_id?: string | null
          contesto?: string
          copia?: string[]
          creato_il?: string
          destinatari?: string[]
          documento_id?: string | null
          errore?: string | null
          esito?: string
          id?: never
          inviata_da?: string | null
          message_id?: string | null
          mittente?: string
          oggetto?: string
          testo?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_email_inviate_anagrafica_id_fkey"
            columns: ["anagrafica_id"]
            isOneToOne: false
            referencedRelation: "gest_anagrafiche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_email_inviate_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_impostazioni: {
        Row: {
          chiave: string
          descrizione: string | null
          updated_at: string
          valore: string
        }
        Insert: {
          chiave: string
          descrizione?: string | null
          updated_at?: string
          valore: string
        }
        Update: {
          chiave?: string
          descrizione?: string | null
          updated_at?: string
          valore?: string
        }
        Relationships: []
      }
      gest_movimenti: {
        Row: {
          creato_il: string
          documento_id: string | null
          id: number
          nota: string | null
          pezza_id: string | null
          quantita: number
          riferimento_id: string | null
          riferimento_tipo: string | null
          riga_id: string | null
          sfrido_codice: string | null
          storno_di: number | null
          tipo: string
          utente: string | null
          variante_id: string
        }
        Insert: {
          creato_il?: string
          documento_id?: string | null
          id?: never
          nota?: string | null
          pezza_id?: string | null
          quantita: number
          riferimento_id?: string | null
          riferimento_tipo?: string | null
          riga_id?: string | null
          sfrido_codice?: string | null
          storno_di?: number | null
          tipo: string
          utente?: string | null
          variante_id: string
        }
        Update: {
          creato_il?: string
          documento_id?: string | null
          id?: never
          nota?: string | null
          pezza_id?: string | null
          quantita?: number
          riferimento_id?: string | null
          riferimento_tipo?: string | null
          riga_id?: string | null
          sfrido_codice?: string | null
          storno_di?: number | null
          tipo?: string
          utente?: string | null
          variante_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_movimenti_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_movimenti_pezza_id_fkey"
            columns: ["pezza_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_pezze"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_movimenti_pezza_id_fkey"
            columns: ["pezza_id"]
            isOneToOne: false
            referencedRelation: "gest_pezze"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_movimenti_storno_di_fkey"
            columns: ["storno_di"]
            isOneToOne: false
            referencedRelation: "gest_movimenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_movimenti_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_movimenti_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_numeratori: {
        Row: {
          anno: number
          serie: string
          tipo: string
          ultimo: number
        }
        Insert: {
          anno: number
          serie?: string
          tipo: string
          ultimo?: number
        }
        Update: {
          anno?: number
          serie?: string
          tipo?: string
          ultimo?: number
        }
        Relationships: []
      }
      gest_pagamenti: {
        Row: {
          bank_allocation_id: string | null
          bank_transaction_id: string | null
          conto: string | null
          creato_il: string
          data: string
          id: number
          importo: number
          modalita: string | null
          nota: string | null
          origine: string
          scadenza_id: string
          storno_di: number | null
          utente: string | null
        }
        Insert: {
          bank_allocation_id?: string | null
          bank_transaction_id?: string | null
          conto?: string | null
          creato_il?: string
          data?: string
          id?: never
          importo: number
          modalita?: string | null
          nota?: string | null
          origine?: string
          scadenza_id: string
          storno_di?: number | null
          utente?: string | null
        }
        Update: {
          bank_allocation_id?: string | null
          bank_transaction_id?: string | null
          conto?: string | null
          creato_il?: string
          data?: string
          id?: never
          importo?: number
          modalita?: string | null
          nota?: string | null
          origine?: string
          scadenza_id?: string
          storno_di?: number | null
          utente?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_pagamenti_scadenza_id_fkey"
            columns: ["scadenza_id"]
            isOneToOne: false
            referencedRelation: "gest_scadenzario"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_pagamenti_scadenza_id_fkey"
            columns: ["scadenza_id"]
            isOneToOne: false
            referencedRelation: "gest_scadenze"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_pagamenti_storno_di_fkey"
            columns: ["storno_di"]
            isOneToOne: false
            referencedRelation: "gest_pagamenti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_pezze: {
        Row: {
          archiviato_il: string | null
          bagno_id: string | null
          codice: string
          created_at: string
          id: string
          lunghezza_iniziale_m: number
          note: string | null
          posizione: string | null
          stato: string
          updated_at: string
          variante_id: string
        }
        Insert: {
          archiviato_il?: string | null
          bagno_id?: string | null
          codice: string
          created_at?: string
          id?: string
          lunghezza_iniziale_m: number
          note?: string | null
          posizione?: string | null
          stato?: string
          updated_at?: string
          variante_id: string
        }
        Update: {
          archiviato_il?: string | null
          bagno_id?: string | null
          codice?: string
          created_at?: string
          id?: string
          lunghezza_iniziale_m?: number
          note?: string | null
          posizione?: string | null
          stato?: string
          updated_at?: string
          variante_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_pezze_bagno_id_fkey"
            columns: ["bagno_id"]
            isOneToOne: false
            referencedRelation: "gest_bagni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_pezze_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_pezze_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_prima_nota: {
        Row: {
          anagrafica_id: string | null
          conto: string
          creato_il: string
          data: string
          descrizione: string
          documento_rif: string
          id: number
          importo: number
          storno_di: number | null
          utente: string | null
          verso: string
        }
        Insert: {
          anagrafica_id?: string | null
          conto: string
          creato_il?: string
          data?: string
          descrizione: string
          documento_rif: string
          id?: never
          importo: number
          storno_di?: number | null
          utente?: string | null
          verso: string
        }
        Update: {
          anagrafica_id?: string | null
          conto?: string
          creato_il?: string
          data?: string
          descrizione?: string
          documento_rif?: string
          id?: never
          importo?: number
          storno_di?: number | null
          utente?: string | null
          verso?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_prima_nota_anagrafica_id_fkey"
            columns: ["anagrafica_id"]
            isOneToOne: false
            referencedRelation: "gest_anagrafiche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_prima_nota_storno_di_fkey"
            columns: ["storno_di"]
            isOneToOne: false
            referencedRelation: "gest_prima_nota"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_scadenze: {
        Row: {
          anagrafica_id: string | null
          annullata_il: string | null
          contabilita_key: string | null
          contabilita_movimento_id: string | null
          created_at: string
          data_scadenza: string
          documento_id: string
          id: string
          importo: number
          modalita: string | null
          note: string | null
          numero_rata: number
          updated_at: string
          verso: string
        }
        Insert: {
          anagrafica_id?: string | null
          annullata_il?: string | null
          contabilita_key?: string | null
          contabilita_movimento_id?: string | null
          created_at?: string
          data_scadenza: string
          documento_id: string
          id?: string
          importo: number
          modalita?: string | null
          note?: string | null
          numero_rata?: number
          updated_at?: string
          verso: string
        }
        Update: {
          anagrafica_id?: string | null
          annullata_il?: string | null
          contabilita_key?: string | null
          contabilita_movimento_id?: string | null
          created_at?: string
          data_scadenza?: string
          documento_id?: string
          id?: string
          importo?: number
          modalita?: string | null
          note?: string | null
          numero_rata?: number
          updated_at?: string
          verso?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_scadenze_anagrafica_id_fkey"
            columns: ["anagrafica_id"]
            isOneToOne: false
            referencedRelation: "gest_anagrafiche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_scadenze_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_storico: {
        Row: {
          dopo: Json | null
          id: number
          operazione: string
          prima: Json | null
          quando: string
          record_id: string
          tabella: string
          utente: string | null
        }
        Insert: {
          dopo?: Json | null
          id?: never
          operazione: string
          prima?: Json | null
          quando?: string
          record_id: string
          tabella: string
          utente?: string | null
        }
        Update: {
          dopo?: Json | null
          id?: never
          operazione?: string
          prima?: Json | null
          quando?: string
          record_id?: string
          tabella?: string
          utente?: string | null
        }
        Relationships: []
      }
      gest_varianti: {
        Row: {
          altezza_cm: number | null
          archiviato_il: string | null
          articolo_id: string
          certificato_rif: string | null
          classe_reazione: string | null
          codice: string
          colore: string | null
          costo_um: number | null
          created_at: string
          finitura: string | null
          formato_altezza_mm: number | null
          formato_larghezza_mm: number | null
          id: string
          ignifugo: boolean
          inventory_item_id: string | null
          note: string | null
          peso_gm2: number | null
          prezzo_um: number | null
          spessore_mm: number | null
          updated_at: string
        }
        Insert: {
          altezza_cm?: number | null
          archiviato_il?: string | null
          articolo_id: string
          certificato_rif?: string | null
          classe_reazione?: string | null
          codice: string
          colore?: string | null
          costo_um?: number | null
          created_at?: string
          finitura?: string | null
          formato_altezza_mm?: number | null
          formato_larghezza_mm?: number | null
          id?: string
          ignifugo?: boolean
          inventory_item_id?: string | null
          note?: string | null
          peso_gm2?: number | null
          prezzo_um?: number | null
          spessore_mm?: number | null
          updated_at?: string
        }
        Update: {
          altezza_cm?: number | null
          archiviato_il?: string | null
          articolo_id?: string
          certificato_rif?: string | null
          classe_reazione?: string | null
          codice?: string
          colore?: string | null
          costo_um?: number | null
          created_at?: string
          finitura?: string | null
          formato_altezza_mm?: number | null
          formato_larghezza_mm?: number | null
          id?: string
          ignifugo?: boolean
          inventory_item_id?: string | null
          note?: string | null
          peso_gm2?: number | null
          prezzo_um?: number | null
          spessore_mm?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gest_varianti_articolo_id_fkey"
            columns: ["articolo_id"]
            isOneToOne: false
            referencedRelation: "gest_articoli"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_varianti_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
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
          completed_at: string | null
          completed_by: string | null
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
          completed_at?: string | null
          completed_by?: string | null
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
          completed_at?: string | null
          completed_by?: string | null
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
      notification_push_config: {
        Row: {
          id: boolean
          token: string
        }
        Insert: {
          id?: boolean
          token?: string
        }
        Update: {
          id?: boolean
          token?: string
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
      gest_documenti_iva: {
        Row: {
          aliquota_id: string | null
          codice: string | null
          descrizione: string | null
          documento_id: string | null
          imponibile: number | null
          imposta: number | null
          natura: string | null
          percentuale: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_documenti_righe_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_giacenze_bagno: {
        Row: {
          bagno_id: string | null
          codice_bagno: string | null
          metri: number | null
          pezza_piu_lunga_m: number | null
          pezze: number | null
          variante_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_pezze_bagno_id_fkey"
            columns: ["bagno_id"]
            isOneToOne: false
            referencedRelation: "gest_bagni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_pezze_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_pezze_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_giacenze_pezze: {
        Row: {
          bagno_id: string | null
          codice: string | null
          codice_bagno: string | null
          created_at: string | null
          id: string | null
          lunghezza_iniziale_m: number | null
          posizione: string | null
          residuo_m: number | null
          stato: string | null
          variante_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_pezze_bagno_id_fkey"
            columns: ["bagno_id"]
            isOneToOne: false
            referencedRelation: "gest_bagni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_pezze_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_pezze_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_giacenze_varianti: {
        Row: {
          articolo_id: string | null
          codice: string | null
          disponibile: number | null
          giacenza: number | null
          impegnato: number | null
          variante_id: string | null
        }
        Insert: {
          articolo_id?: string | null
          codice?: string | null
          disponibile?: never
          giacenza?: never
          impegnato?: never
          variante_id?: string | null
        }
        Update: {
          articolo_id?: string | null
          codice?: string | null
          disponibile?: never
          giacenza?: never
          impegnato?: never
          variante_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_varianti_articolo_id_fkey"
            columns: ["articolo_id"]
            isOneToOne: false
            referencedRelation: "gest_articoli"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_impegni: {
        Row: {
          anagrafica_id: string | null
          anno: number | null
          consegna_prevista: string | null
          consegnata: number | null
          data: string | null
          descrizione: string | null
          documento_id: string | null
          impegnata: number | null
          numero: number | null
          ordinata: number | null
          produzione: string | null
          ragione_sociale: string | null
          riga_id: string | null
          serie: string | null
          um: string | null
          variante_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_documenti_anagrafica_id_fkey"
            columns: ["anagrafica_id"]
            isOneToOne: false
            referencedRelation: "gest_anagrafiche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_giacenze_varianti"
            referencedColumns: ["variante_id"]
          },
          {
            foreignKeyName: "gest_documenti_righe_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "gest_varianti"
            referencedColumns: ["id"]
          },
        ]
      }
      gest_prima_nota_vista: {
        Row: {
          conto: string | null
          creato_il: string | null
          data: string | null
          descrizione: string | null
          documento_id: string | null
          documento_numero: string | null
          documento_rif: string | null
          documento_tipo: string | null
          e_storno: boolean | null
          id: string | null
          importo: number | null
          manuale_id: number | null
          origine: string | null
          pagamento_id: number | null
          ragione_sociale: string | null
          scadenza_id: string | null
          verso: string | null
        }
        Relationships: []
      }
      gest_scadenzario: {
        Row: {
          anagrafica_id: string | null
          data_scadenza: string | null
          documento_anno: number | null
          documento_data: string | null
          documento_id: string | null
          documento_numero: number | null
          documento_serie: string | null
          documento_tipo: string | null
          id: string | null
          importo: number | null
          in_contabilita: boolean | null
          modalita: string | null
          note: string | null
          numero_rata: number | null
          pagato: number | null
          ragione_sociale: string | null
          residuo: number | null
          riferimento_esterno: string | null
          stato: string | null
          ultimo_pagamento: string | null
          verso: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gest_scadenze_anagrafica_id_fkey"
            columns: ["anagrafica_id"]
            isOneToOne: false
            referencedRelation: "gest_anagrafiche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gest_scadenze_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "gest_documenti"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_obio_sync: { Args: { _run: string }; Returns: boolean }
      activate_bank_schedule: {
        Args: { _endpoint: string; _token: string }
        Returns: undefined
      }
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
      auto_register_bank_cash: { Args: { _entries: Json }; Returns: Json }
      bank_transaction_fingerprint: {
        Args: { _amount: number; _date: string; _description: string }
        Returns: string
      }
      can_reconcile_bank: { Args: { _uid: string }; Returns: boolean }
      can_use_contabilita: { Args: { _uid: string }; Returns: boolean }
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
      contabilita_agg_tombstones: { Args: { _del: Json }; Returns: Json }
      contabilita_merge_hours: {
        Args: { _new: Json; _old: Json }
        Returns: Json
      }
      contabilita_merge_list: {
        Args: { _deleted: Json; _new: Json; _old: Json }
        Returns: Json
      }
      contabilita_payroll_keys: { Args: never; Returns: string[] }
      debug_flow_launch_permissions: { Args: never; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dispatch_bank_schedule: { Args: never; Returns: undefined }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      gest_annulla_documento: {
        Args: { _documento_id: string; _motivo?: string }
        Returns: undefined
      }
      gest_carica_pezza: {
        Args: {
          _codice_bagno?: string
          _fornitore?: string
          _metri: number
          _nota?: string
          _posizione?: string
          _variante_id: string
        }
        Returns: {
          archiviato_il: string | null
          bagno_id: string | null
          codice: string
          created_at: string
          id: string
          lunghezza_iniziale_m: number
          note: string | null
          posizione: string | null
          stato: string
          updated_at: string
          variante_id: string
        }
        SetofOptions: {
          from: "*"
          to: "gest_pezze"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      gest_chiudi_impegno: {
        Args: { _chiudi?: boolean; _documento_id: string }
        Returns: undefined
      }
      gest_collega_scadenza: {
        Args: { _scadenza_id: string }
        Returns: boolean
      }
      gest_conferma_documento: {
        Args: { _documento_id: string }
        Returns: {
          accompagnatoria: boolean
          anagrafica_id: string | null
          anno: number | null
          annullato_il: string | null
          aspetto_beni: string | null
          bollo_virtuale: boolean
          causale_trasporto: string | null
          cig: string | null
          colli: number | null
          condizione_pagamento_id: string | null
          confermato_da: string | null
          confermato_il: string | null
          consegna_prevista: string | null
          created_at: string
          creato_da: string | null
          cup: string | null
          data: string
          data_esterna: string | null
          design_draft_id: string | null
          destinazione: string | null
          esigibilita_iva: string
          id: string
          impegno_chiuso_il: string | null
          imponibile: number
          imposta: number
          intestatario: Json | null
          motivo_annullamento: string | null
          note: string | null
          note_interne: string | null
          numero: number | null
          oggetto: string | null
          ordine_cliente_tipo: string | null
          origine_id: string | null
          pagamento: string | null
          peso_kg: number | null
          porto: string | null
          produzione: string | null
          riferimento_esterno: string | null
          serie: string
          stato: string
          tipo: string
          totale: number
          updated_at: string
          validita_giorni: number | null
          vettore: string | null
        }
        SetofOptions: {
          from: "*"
          to: "gest_documenti"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      gest_cont_incasso_contanti: {
        Args: { _pagamento_id: number }
        Returns: undefined
      }
      gest_cont_key: { Args: { _data: string }; Returns: string }
      gest_cont_rimuovi_voce: {
        Args: { _id: string; _key: string }
        Returns: boolean
      }
      gest_cont_scrivi_competenza: {
        Args: { _importo: number; _scadenza_id: string }
        Returns: string
      }
      gest_cont_storno_contanti: {
        Args: { _pagamento_id: number }
        Returns: undefined
      }
      gest_cont_togli_competenza: {
        Args: { _scadenza_id: string }
        Returns: undefined
      }
      gest_deriva_documento: {
        Args: { _origine_id: string; _tipo: string }
        Returns: string
      }
      gest_genera_scadenze: {
        Args: { _documento_id: string }
        Returns: undefined
      }
      gest_movimenta_documento: {
        Args: { _documento_id: string }
        Returns: undefined
      }
      gest_percorso_documento: {
        Args: { _documento_id: string }
        Returns: {
          anno: number
          data: string
          id: string
          livello: number
          numero: number
          serie: string
          stato: string
          tipo: string
        }[]
      }
      gest_prima_nota_registra: {
        Args: {
          _anagrafica_id?: string
          _conto: string
          _data: string
          _descrizione: string
          _documento_rif: string
          _importo: number
          _verso: string
        }
        Returns: number
      }
      gest_prima_nota_storna: { Args: { _id: number }; Returns: undefined }
      gest_registra_pagamento: {
        Args: {
          _conto?: string
          _data?: string
          _importo: number
          _modalita?: string
          _nota?: string
          _scadenza_id: string
        }
        Returns: number
      }
      gest_riallinea_banca: { Args: never; Returns: number }
      gest_ricalcola_totali: {
        Args: { _documento_id: string }
        Returns: undefined
      }
      gest_storna_documento: {
        Args: { _documento_id: string }
        Returns: undefined
      }
      gest_storna_movimento: {
        Args: { _movimento_id: number; _nota?: string }
        Returns: number
      }
      gest_storna_pagamento: {
        Args: { _nota?: string; _pagamento_id: number }
        Returns: undefined
      }
      gest_taglia_pezza: {
        Args: {
          _metri: number
          _nota?: string
          _pezza_id: string
          _rif_id?: string
          _rif_tipo?: string
        }
        Returns: number
      }
      get_admin_user_ids: { Args: never; Returns: string[] }
      get_bank_provider_connections: {
        Args: never
        Returns: {
          account_count: number
          bank: string
          consent_expires_at: string
          id: string
          last_error: string
          last_sync_at: string
          status: string
        }[]
      }
      get_bank_schedule_status: { Args: never; Returns: Json }
      get_contabilita_cash_only: { Args: { _key?: string }; Returns: Json }
      get_contabilita_state_public: {
        Args: { _key: string }
        Returns: {
          data: Json
          updated_at: string
        }[]
      }
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
      import_bank_transactions: { Args: { _rows: Json }; Returns: number }
      is_amministrazione: { Args: { _user_id: string }; Returns: boolean }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      is_dm_member: {
        Args: { _channel_id: string; _user_id: string }
        Returns: boolean
      }
      is_draft_owner: {
        Args: { _draft: string; _user: string }
        Returns: boolean
      }
      is_draft_shared_with: {
        Args: { _draft: string; _user: string }
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
      is_salary_owner: { Args: { _user_id: string }; Returns: boolean }
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
      manage_bank_transactions: {
        Args: { _action: string; _rows: Json }
        Returns: number
      }
      mark_salary_cash_paid: {
        Args: {
          _amount: number
          _comp_month: number
          _key: string
          _name: string
          _paid: boolean
        }
        Returns: undefined
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
      prepare_bank_schedule: {
        Args: { _endpoint: string; _token: string }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reconcile_bank_transaction: {
        Args: {
          _amount: number
          _category: string
          _competence_id: string
          _description: string
          _expected_acconto?: number
          _expected_amount?: number
          _request_id: string
          _transaction_id: string
        }
        Returns: Json
      }
      reconcile_bank_transactions: { Args: { _entries: Json }; Returns: Json }
      reconcile_bank_transactions_core: {
        Args: { _actor: string; _entries: Json }
        Returns: Json
      }
      release_obio_sync: { Args: { _run: string }; Returns: undefined }
      reopen_project_draft: { Args: { _draft: string }; Returns: undefined }
      return_order_to_revision: {
        Args: { _order_id: string; _reason: string; _sub_order_id: string }
        Returns: string
      }
      save_contabilita_state_public: {
        Args: { _data: Json; _key: string }
        Returns: string
      }
      store_bank_transactions: {
        Args: { _actor?: string; _rows: Json; _source: string }
        Returns: number
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
        | "task_assegnato"
        | "task_sbloccato"
        | "task_completato"
        | "task_scaduto"
        | "task_mention"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "task_assegnato",
        "task_sbloccato",
        "task_completato",
        "task_scaduto",
        "task_mention",
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
