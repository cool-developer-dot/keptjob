
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activities": {
                  Row: {
                    "content": string | null,"created_at": string,"id": string,"metadata": NonNullable<Json>,"occurred_at": string,"prospect_id": string,"type": Database["public"]['Enums']["activity_type"],"user_id": string | null
                  }
                  Insert: {
                    "content"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"prospect_id": string,"type": Database["public"]['Enums']["activity_type"],"user_id"?: string | null
                  }
                  Update: {
                    "content"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"prospect_id"?: string,"type"?: Database["public"]['Enums']["activity_type"],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects_with_flags"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_insights": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deal_health": Database["public"]['Enums']["deal_health"],"decision_maker_status": Database["public"]['Enums']["decision_maker_status"],"id": string,"main_objection": string,"model": string,"prospect_id": string,"recommended_next_step": string,"summary": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deal_health": Database["public"]['Enums']["deal_health"],"decision_maker_status": Database["public"]['Enums']["decision_maker_status"],"id"?: string,"main_objection": string,"model": string,"prospect_id": string,"recommended_next_step": string,"summary": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deal_health"?: Database["public"]['Enums']["deal_health"],"decision_maker_status"?: Database["public"]['Enums']["decision_maker_status"],"id"?: string,"main_objection"?: string,"model"?: string,"prospect_id"?: string,"recommended_next_step"?: string,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_insights_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_insights_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_insights_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects_with_flags"
      referencedColumns: ["id"]
    }
                  ]
                },"follow_ups": {
                  Row: {
                    "completed_at": string | null,"completed_by": string | null,"created_at": string,"created_by": string | null,"due_date": string,"id": string,"note": string,"owner_id": string,"prospect_id": string,"status": Database["public"]['Enums']["follow_up_status"],"updated_at": string
                  }
                  Insert: {
                    "completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_date": string,"id"?: string,"note": string,"owner_id": string,"prospect_id": string,"status"?: Database["public"]['Enums']["follow_up_status"],"updated_at"?: string
                  }
                  Update: {
                    "completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_date"?: string,"id"?: string,"note"?: string,"owner_id"?: string,"prospect_id"?: string,"status"?: Database["public"]['Enums']["follow_up_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follow_ups_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follow_ups_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follow_ups_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follow_ups_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follow_ups_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects_with_flags"
      referencedColumns: ["id"]
    }
                  ]
                },"org_settings": {
                  Row: {
                    "default_currency": string,"id": boolean,"stale_days": number,"timezone": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "default_currency"?: string,"id"?: boolean,"stale_days"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "default_currency"?: string,"id"?: boolean,"stale_days"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"prospects": {
                  Row: {
                    "close_notes": string | null,"close_reason": string | null,"closed_at": string | null,"company": string | null,"created_at": string,"created_by": string | null,"currency": string,"deal_value": number | null,"decision_maker_status": Database["public"]['Enums']["decision_maker_status"],"demo_at": string | null,"email": string | null,"follow_up_date": string | null,"id": string,"last_activity_at": string,"name": string,"notes": string | null,"objection_notes": string | null,"objections": (Database["public"]['Enums']["objection_category"])[],"owner_id": string,"phone": string | null,"stage": Database["public"]['Enums']["pipeline_stage"],"updated_at": string
                  }
                  Insert: {
                    "close_notes"?: string | null,"close_reason"?: string | null,"closed_at"?: string | null,"company"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": string,"deal_value"?: number | null,"decision_maker_status"?: Database["public"]['Enums']["decision_maker_status"],"demo_at"?: string | null,"email"?: string | null,"follow_up_date"?: string | null,"id"?: string,"last_activity_at"?: string,"name": string,"notes"?: string | null,"objection_notes"?: string | null,"objections"?: (Database["public"]['Enums']["objection_category"])[],"owner_id": string,"phone"?: string | null,"stage"?: Database["public"]['Enums']["pipeline_stage"],"updated_at"?: string
                  }
                  Update: {
                    "close_notes"?: string | null,"close_reason"?: string | null,"closed_at"?: string | null,"company"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"deal_value"?: number | null,"decision_maker_status"?: Database["public"]['Enums']["decision_maker_status"],"demo_at"?: string | null,"email"?: string | null,"follow_up_date"?: string | null,"id"?: string,"last_activity_at"?: string,"name"?: string,"notes"?: string | null,"objection_notes"?: string | null,"objections"?: (Database["public"]['Enums']["objection_category"])[],"owner_id"?: string,"phone"?: string | null,"stage"?: Database["public"]['Enums']["pipeline_stage"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prospects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prospects_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"stage_history": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"close_reason": string | null,"from_stage": Database["public"]['Enums']["pipeline_stage"] | null,"id": string,"note": string | null,"prospect_id": string,"to_stage": Database["public"]['Enums']["pipeline_stage"]
                  }
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"close_reason"?: string | null,"from_stage"?: Database["public"]['Enums']["pipeline_stage"] | null,"id"?: string,"note"?: string | null,"prospect_id": string,"to_stage": Database["public"]['Enums']["pipeline_stage"]
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"close_reason"?: string | null,"from_stage"?: Database["public"]['Enums']["pipeline_stage"] | null,"id"?: string,"note"?: string | null,"prospect_id"?: string,"to_stage"?: Database["public"]['Enums']["pipeline_stage"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "stage_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stage_history_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stage_history_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects_with_flags"
      referencedColumns: ["id"]
    }
                  ]
                },"users": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string,"id": string,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "latest_ai_insights": {
                  Row: {
                    "created_at": string | null,"deal_health": Database["public"]['Enums']["deal_health"] | null,"id": string | null,"prospect_id": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_insights_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_insights_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects_with_flags"
      referencedColumns: ["id"]
    }
                  ]
                },"prospects_with_flags": {
                  Row: {
                    "close_notes": string | null,"close_reason": string | null,"closed_at": string | null,"company": string | null,"created_at": string | null,"created_by": string | null,"currency": string | null,"deal_value": number | null,"decision_maker_status": Database["public"]['Enums']["decision_maker_status"] | null,"demo_at": string | null,"email": string | null,"follow_up_date": string | null,"has_overdue_follow_up": boolean | null,"id": string | null,"is_stale": boolean | null,"last_activity_at": string | null,"name": string | null,"notes": string | null,"objection_notes": string | null,"objections": (Database["public"]['Enums']["objection_category"])[] | null,"owner_id": string | null,"phone": string | null,"stage": Database["public"]['Enums']["pipeline_stage"] | null,"updated_at": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "prospects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prospects_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "can_access_prospect":
{ Args: { "p_prospect_id": string }; Returns: boolean
                           },
"is_manager":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"move_prospect_stage":
{ Args: { "p_close_notes"?: string,"p_close_reason"?: string,"p_note"?: string,"p_prospect_id": string,"p_to_stage": Database["public"]['Enums']["pipeline_stage"] }; Returns: {
              "close_notes": string | null,
"close_reason": string | null,
"closed_at": string | null,
"company": string | null,
"created_at": string,
"created_by": string | null,
"currency": string,
"deal_value": number | null,
"decision_maker_status": Database["public"]['Enums']["decision_maker_status"],
"demo_at": string | null,
"email": string | null,
"follow_up_date": string | null,
"id": string,
"last_activity_at": string,
"name": string,
"notes": string | null,
"objection_notes": string | null,
"objections": (Database["public"]['Enums']["objection_category"])[],
"owner_id": string,
"phone": string | null,
"stage": Database["public"]['Enums']["pipeline_stage"],
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "prospects"
        isOneToOne: true
        isSetofReturn: false
      } },
"org_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"refresh_prospect_follow_up_date":
{ Args: { "p_prospect_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "activity_type": "call"|"conversation"|"note"|"demo"|"follow_up"|"stage_change"|"owner_change"|"ai_insight","deal_health": "high"|"medium"|"low","decision_maker_status": "yes"|"no"|"unknown","follow_up_status": "pending"|"completed","objection_category": "price"|"timing"|"competitor"|"budget"|"no_authority"|"not_interested"|"other","pipeline_stage": "prospect"|"contacted"|"conversation"|"qualified"|"demo_booked"|"demo_attended"|"follow_up"|"closed_won"|"closed_lost","user_role": "manager"|"sales_rep"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "activity_type": ["call", "conversation", "note", "demo", "follow_up", "stage_change", "owner_change", "ai_insight"],"deal_health": ["high", "medium", "low"],"decision_maker_status": ["yes", "no", "unknown"],"follow_up_status": ["pending", "completed"],"objection_category": ["price", "timing", "competitor", "budget", "no_authority", "not_interested", "other"],"pipeline_stage": ["prospect", "contacted", "conversation", "qualified", "demo_booked", "demo_attended", "follow_up", "closed_won", "closed_lost"],"user_role": ["manager", "sales_rep"]
          }
        }
} as const
