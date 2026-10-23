export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole = "user" | "admin";
export type OrderStatus =
  | "RESERVING"
  | "PENDING"
  | "RECEIVED"
  | "FINISHED"
  | "CANCELED"
  | "TIMEOUT"
  | "BANNED"
  | "FAILED";
export type TransactionType = "deposit" | "purchase" | "refund" | "adjustment";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          balance_cents: number;
          currency: string;
          role: AppRole;
          is_banned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          balance_cents?: number;
          currency?: string;
          role?: AppRole;
          is_banned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          balance_cents?: number;
          currency?: string;
          role?: AppRole;
          is_banned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          user_id: string;
          idempotency_key: string;
          provider: string;
          provider_order_id: number | null;
          country: string;
          operator: string;
          product: string;
          phone: string | null;
          price_cents: number;
          status: OrderStatus;
          sms_code: string | null;
          sms_text: string | null;
          sms_sender: string | null;
          sms_received_at: string | null;
          sms_messages: Json;
          failure_reason: string | null;
          expires_at: string | null;
          refunded_at: string | null;
          finished_at: string | null;
          last_checked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          idempotency_key: string;
          provider?: string;
          provider_order_id?: number | null;
          country: string;
          operator: string;
          product: string;
          phone?: string | null;
          price_cents: number;
          status?: OrderStatus;
          sms_code?: string | null;
          sms_text?: string | null;
          sms_sender?: string | null;
          sms_received_at?: string | null;
          sms_messages?: Json;
          failure_reason?: string | null;
          expires_at?: string | null;
          refunded_at?: string | null;
          finished_at?: string | null;
          last_checked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          idempotency_key?: string;
          provider?: string;
          provider_order_id?: number | null;
          country?: string;
          operator?: string;
          product?: string;
          phone?: string | null;
          price_cents?: number;
          status?: OrderStatus;
          sms_code?: string | null;
          sms_text?: string | null;
          sms_sender?: string | null;
          sms_received_at?: string | null;
          sms_messages?: Json;
          failure_reason?: string | null;
          expires_at?: string | null;
          refunded_at?: string | null;
          finished_at?: string | null;
          last_checked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          type: TransactionType;
          amount_cents: number;
          balance_after_cents: number;
          order_id: string | null;
          reference: string | null;
          description: string | null;
          metadata: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: TransactionType;
          amount_cents: number;
          balance_after_cents: number;
          order_id?: string | null;
          reference?: string | null;
          description?: string | null;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: TransactionType;
          amount_cents?: number;
          balance_after_cents?: number;
          order_id?: string | null;
          reference?: string | null;
          description?: string | null;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      reserve_order: {
        Args: {
          p_user_id: string;
          p_idempotency_key: string;
          p_country: string;
          p_operator: string;
          p_product: string;
          p_price_cents: number;
          p_quoted_cost: number;
          p_max_active_orders?: number;
        };
        Returns: {
          order_id: string;
          order_status: OrderStatus;
          balance_cents: number;
          is_duplicate: boolean;
        }[];
      };
      confirm_order: {
        Args: {
          p_order_id: string;
          p_provider_order_id: number;
          p_phone: string;
          p_operator: string;
          p_actual_cost: number;
          p_expires_at: string | null;
          p_raw?: Json;
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      refund_order: {
        Args: {
          p_order_id: string;
          p_final_status: OrderStatus;
          p_reason?: string | null;
        };
        Returns: {
          refunded: boolean;
          refund_amount_cents: number;
          balance_cents: number;
        }[];
      };
      sync_order_from_provider: {
        Args: {
          p_order_id: string;
          p_status: OrderStatus;
          p_sms_messages?: Json;
          p_sms_code?: string | null;
          p_sms_text?: string | null;
          p_sms_sender?: string | null;
          p_raw?: Json;
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      adjust_balance: {
        Args: {
          p_user_id: string;
          p_amount_cents: number;
          p_type: TransactionType;
          p_reference?: string | null;
          p_description?: string | null;
          p_metadata?: Json;
          p_created_by?: string | null;
        };
        Returns: {
          transaction_id: string;
          balance_cents: number;
          is_duplicate: boolean;
        }[];
      };
    };
    Enums: {
      app_role: AppRole;
      order_status: OrderStatus;
      transaction_type: TransactionType;
    };
    CompositeTypes: Record<string, never>;
  };
}
