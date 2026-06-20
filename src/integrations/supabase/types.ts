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
      email_accounts: {
        Row: {
          color: string
          created_at: string
          display_name: string | null
          email_address: string
          history_id: string | null
          id: string
          imap_host: string | null
          imap_last_uid: number | null
          imap_password_encrypted: string | null
          imap_port: number | null
          imap_use_tls: boolean | null
          imap_username: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          oauth_access_token: string | null
          oauth_refresh_token: string | null
          oauth_scope: string | null
          oauth_token_expires_at: string | null
          provider_type: Database["public"]["Enums"]["provider_type"]
          smtp_host: string | null
          smtp_password_encrypted: string | null
          smtp_port: number | null
          smtp_username: string | null
          sync_status: Database["public"]["Enums"]["sync_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          display_name?: string | null
          email_address: string
          history_id?: string | null
          id?: string
          imap_host?: string | null
          imap_last_uid?: number | null
          imap_password_encrypted?: string | null
          imap_port?: number | null
          imap_use_tls?: boolean | null
          imap_username?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          oauth_access_token?: string | null
          oauth_refresh_token?: string | null
          oauth_scope?: string | null
          oauth_token_expires_at?: string | null
          provider_type: Database["public"]["Enums"]["provider_type"]
          smtp_host?: string | null
          smtp_password_encrypted?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          display_name?: string | null
          email_address?: string
          history_id?: string | null
          id?: string
          imap_host?: string | null
          imap_last_uid?: number | null
          imap_password_encrypted?: string | null
          imap_port?: number | null
          imap_use_tls?: boolean | null
          imap_username?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          oauth_access_token?: string | null
          oauth_refresh_token?: string | null
          oauth_scope?: string | null
          oauth_token_expires_at?: string | null
          provider_type?: Database["public"]["Enums"]["provider_type"]
          smtp_host?: string | null
          smtp_password_encrypted?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_threads: {
        Row: {
          account_id: string
          created_at: string
          draft_content: Json | null
          folder: string
          gmail_label_ids: string[]
          id: string
          last_message_at: string
          message_count: number
          participants: string[] | null
          provider_thread_id: string | null
          search_tsv: unknown
          snippet: string | null
          subject: string | null
          unread_count: number
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          draft_content?: Json | null
          folder?: string
          gmail_label_ids?: string[]
          id?: string
          last_message_at?: string
          message_count?: number
          participants?: string[] | null
          provider_thread_id?: string | null
          snippet?: string | null
          subject?: string | null
          unread_count?: number
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          draft_content?: Json | null
          folder?: string
          gmail_label_ids?: string[]
          id?: string
          last_message_at?: string
          message_count?: number
          participants?: string[] | null
          provider_thread_id?: string | null
          snippet?: string | null
          subject?: string | null
          unread_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          account_id: string
          attachments: Json | null
          bcc: string[] | null
          body_html: string | null
          body_text: string | null
          cc: string[] | null
          created_at: string
          direction: Database["public"]["Enums"]["email_direction"]
          id: string
          is_read: boolean
          is_starred: boolean
          provider_message_id: string | null
          recipient: string
          references_header: string | null
          rfc_message_id: string | null
          search_tsv: unknown
          sender: string
          sender_name: string | null
          sent_at: string
          snippet: string | null
          subject: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          attachments?: Json | null
          bcc?: string[] | null
          body_html?: string | null
          body_text?: string | null
          cc?: string[] | null
          created_at?: string
          direction?: Database["public"]["Enums"]["email_direction"]
          id?: string
          is_read?: boolean
          is_starred?: boolean
          provider_message_id?: string | null
          recipient: string
          references_header?: string | null
          rfc_message_id?: string | null
          sender: string
          sender_name?: string | null
          sent_at?: string
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          attachments?: Json | null
          bcc?: string[] | null
          body_html?: string | null
          body_text?: string | null
          cc?: string[] | null
          created_at?: string
          direction?: Database["public"]["Enums"]["email_direction"]
          id?: string
          is_read?: boolean
          is_starred?: boolean
          provider_message_id?: string | null
          recipient?: string
          references_header?: string | null
          rfc_message_id?: string | null
          sender?: string
          sender_name?: string | null
          sent_at?: string
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_inbox_threads_enriched: {
        Args: {
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          result: Json
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      email_direction: "inbound" | "outbound"
      provider_type: "gmail" | "imap"
      sync_status: "idle" | "syncing" | "error" | "disconnected"
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
      app_role: ["admin", "user"],
      email_direction: ["inbound", "outbound"],
      provider_type: ["gmail", "imap"],
      sync_status: ["idle", "syncing", "error", "disconnected"],
    },
  },
} as const
