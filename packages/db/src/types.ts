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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          address1: string
          address2: string | null
          city_id: string | null
          created_at: string
          customer_id: string
          district: string | null
          id: string
          is_default: boolean
          region_id: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address1: string
          address2?: string | null
          city_id?: string | null
          created_at?: string
          customer_id: string
          district?: string | null
          id?: string
          is_default?: boolean
          region_id?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address1?: string
          address2?: string | null
          city_id?: string | null
          created_at?: string
          customer_id?: string
          district?: string | null
          id?: string
          is_default?: boolean
          region_id?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addresses_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          auth_user_id: string
          created_at: string
          is_active: boolean
          mfa_required: boolean
          name: string
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          is_active?: boolean
          mfa_required?: boolean
          name: string
          role: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          is_active?: boolean
          mfa_required?: boolean
          name?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          country_code: string
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          link_url: string | null
          sort_order: number
          text: string
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
          text: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: string
          ip: unknown
          updated_at: string
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          ip?: unknown
          updated_at?: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          ip?: unknown
          updated_at?: string
        }
        Relationships: []
      }
      banners: {
        Row: {
          alt: string
          category_id: string | null
          country_code: string
          created_at: string
          cta_label: string | null
          desktop_media_id: string
          ends_at: string | null
          id: string
          is_active: boolean
          link_url: string | null
          mobile_media_id: string
          placement: string
          sort_order: number
          starts_at: string | null
          subtitle: string | null
          text_color: string | null
          text_position: string
          title: string | null
          updated_at: string
        }
        Insert: {
          alt: string
          category_id?: string | null
          country_code: string
          created_at?: string
          cta_label?: string | null
          desktop_media_id: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          mobile_media_id: string
          placement: string
          sort_order?: number
          starts_at?: string | null
          subtitle?: string | null
          text_color?: string | null
          text_position?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          alt?: string
          category_id?: string | null
          country_code?: string
          created_at?: string
          cta_label?: string | null
          desktop_media_id?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          mobile_media_id?: string
          placement?: string
          sort_order?: number
          starts_at?: string | null
          subtitle?: string | null
          text_color?: string | null
          text_position?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banners_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banners_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "banners_desktop_media_id_fkey"
            columns: ["desktop_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banners_mobile_media_id_fkey"
            columns: ["mobile_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_id: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_id?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_id?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_listing: {
        Row: {
          badges: string[]
          brand_name: string | null
          brand_slug: string | null
          category_ids: string[]
          compare_at_price: number | null
          concentration_slug: string | null
          country_code: string
          created_at: string
          discount_pct: number
          family_slug: string | null
          gender_slug: string | null
          img_hover: Json | null
          img_primary: Json | null
          in_stock: boolean
          is_visible: boolean
          max_price: number | null
          min_price: number | null
          name: string
          name_unaccent: string
          product_id: string
          published_at: string | null
          rating_avg: number | null
          rating_count: number
          sales_30d: number
          search_tsv: unknown
          slug: string
          sort_featured: number
          updated_at: string
          variant_count: number
        }
        Insert: {
          badges?: string[]
          brand_name?: string | null
          brand_slug?: string | null
          category_ids?: string[]
          compare_at_price?: number | null
          concentration_slug?: string | null
          country_code: string
          created_at?: string
          discount_pct?: number
          family_slug?: string | null
          gender_slug?: string | null
          img_hover?: Json | null
          img_primary?: Json | null
          in_stock?: boolean
          is_visible?: boolean
          max_price?: number | null
          min_price?: number | null
          name: string
          name_unaccent: string
          product_id: string
          published_at?: string | null
          rating_avg?: number | null
          rating_count?: number
          sales_30d?: number
          search_tsv?: unknown
          slug: string
          sort_featured?: number
          updated_at?: string
          variant_count?: number
        }
        Update: {
          badges?: string[]
          brand_name?: string | null
          brand_slug?: string | null
          category_ids?: string[]
          compare_at_price?: number | null
          concentration_slug?: string | null
          country_code?: string
          created_at?: string
          discount_pct?: number
          family_slug?: string | null
          gender_slug?: string | null
          img_hover?: Json | null
          img_primary?: Json | null
          in_stock?: boolean
          is_visible?: boolean
          max_price?: number | null
          min_price?: number | null
          name?: string
          name_unaccent?: string
          product_id?: string
          published_at?: string | null
          rating_avg?: number | null
          rating_count?: number
          sales_30d?: number
          search_tsv?: unknown
          slug?: string
          sort_featured?: number
          updated_at?: string
          variant_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_listing_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "catalog_listing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          banner_image_id: string | null
          created_at: string
          description: string | null
          id: string
          image_id: string | null
          name: string
          parent_id: string | null
          seo_description: string | null
          seo_title: string | null
          show_in_menu: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          banner_image_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_id?: string | null
          name: string
          parent_id?: string | null
          seo_description?: string | null
          seo_title?: string | null
          show_in_menu?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          banner_image_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_id?: string | null
          name?: string
          parent_id?: string | null
          seo_description?: string | null
          seo_title?: string | null
          show_in_menu?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_banner_image_id_fkey"
            columns: ["banner_image_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_countries: {
        Row: {
          category_id: string
          country_code: string
          created_at: string
          is_visible: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          country_code: string
          created_at?: string
          is_visible?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          country_code?: string
          created_at?: string
          is_visible?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_countries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_countries_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string | null
          cost_usd_micros: number
          created_at: string
          id: string
          model: string | null
          role: string
          session_id: string
          tokens_in: number
          tokens_out: number
          tool_calls: Json | null
          updated_at: string
        }
        Insert: {
          content?: string | null
          cost_usd_micros?: number
          created_at?: string
          id?: string
          model?: string | null
          role: string
          session_id: string
          tokens_in?: number
          tokens_out?: number
          tool_calls?: Json | null
          updated_at?: string
        }
        Update: {
          content?: string | null
          cost_usd_micros?: number
          created_at?: string
          id?: string
          model?: string | null
          role?: string
          session_id?: string
          tokens_in?: number
          tokens_out?: number
          tool_calls?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          converted_order_id: string | null
          country_code: string
          created_at: string
          customer_id: string | null
          id: string
          last_message_at: string | null
          messages_count: number
          started_at: string
          updated_at: string
          visitor_id: string
        }
        Insert: {
          converted_order_id?: string | null
          country_code: string
          created_at?: string
          customer_id?: string | null
          id?: string
          last_message_at?: string | null
          messages_count?: number
          started_at?: string
          updated_at?: string
          visitor_id: string
        }
        Update: {
          converted_order_id?: string | null
          country_code?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          last_message_at?: string | null
          messages_count?: number
          started_at?: string
          updated_at?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "chat_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_settings: {
        Row: {
          created_at: string
          degrade_at_pct: number
          extra_instructions: string | null
          history_turns: number
          id: boolean
          is_enabled: boolean
          max_input_chars: number
          max_messages_per_session: number
          max_output_tokens: number
          model_fallback: string | null
          model_primary: string | null
          monthly_budget_usd_micros: number
          provider: string
          updated_at: string
          welcome_message: Json
        }
        Insert: {
          created_at?: string
          degrade_at_pct?: number
          extra_instructions?: string | null
          history_turns?: number
          id?: boolean
          is_enabled?: boolean
          max_input_chars?: number
          max_messages_per_session?: number
          max_output_tokens?: number
          model_fallback?: string | null
          model_primary?: string | null
          monthly_budget_usd_micros?: number
          provider?: string
          updated_at?: string
          welcome_message?: Json
        }
        Update: {
          created_at?: string
          degrade_at_pct?: number
          extra_instructions?: string | null
          history_turns?: number
          id?: boolean
          is_enabled?: boolean
          max_input_chars?: number
          max_messages_per_session?: number
          max_output_tokens?: number
          model_fallback?: string | null
          model_primary?: string | null
          monthly_budget_usd_micros?: number
          provider?: string
          updated_at?: string
          welcome_message?: Json
        }
        Relationships: []
      }
      chat_usage_monthly: {
        Row: {
          cost_usd_micros: number
          created_at: string
          messages: number
          month: string
          updated_at: string
        }
        Insert: {
          cost_usd_micros?: number
          created_at?: string
          messages?: number
          month: string
          updated_at?: string
        }
        Update: {
          cost_usd_micros?: number
          created_at?: string
          messages?: number
          month?: string
          updated_at?: string
        }
        Relationships: []
      }
      cities: {
        Row: {
          code: string
          created_at: string
          id: string
          is_capital: boolean
          name: string
          region_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_capital?: boolean
          name: string
          region_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_capital?: boolean
          name?: string
          region_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cities_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_items: {
        Row: {
          collection_id: string
          created_at: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          country_code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          rule: Json | null
          show_in_home_tabs: boolean
          slug: string
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          rule?: Json | null
          show_in_home_tabs?: boolean
          slug: string
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          rule?: Json | null
          show_in_home_tabs?: boolean
          slug?: string
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      concentrations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      content_slots: {
        Row: {
          body: string | null
          country_code: string | null
          created_at: string
          id: string
          is_active: boolean
          key: string
          link_url: string | null
          media_id: string | null
          mobile_media_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          link_url?: string | null
          media_id?: string | null
          mobile_media_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          link_url?: string | null
          media_id?: string | null
          mobile_media_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_slots_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "content_slots_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_slots_mobile_media_id_fkey"
            columns: ["mobile_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          created_at: string
          currency_code: string
          is_active: boolean
          locale: string
          name: string
          phone_prefix: string
          timezone: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency_code: string
          is_active?: boolean
          locale: string
          name: string
          phone_prefix: string
          timezone: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency_code?: string
          is_active?: boolean
          locale?: string
          name?: string
          phone_prefix?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "countries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      country_settings: {
        Row: {
          advisor_whatsapp: string | null
          announcement_rotation_seconds: number
          carrier_auto_confirm: boolean
          carrier_discount_mode: string
          carrier_provider: string | null
          carrier_wallet_balance: number | null
          carrier_wallet_balance_at: string | null
          carrier_wallet_low_alert_at: string | null
          carrier_wallet_low_balance: number | null
          cod_deposit_amount: number
          cod_enabled: boolean
          cod_link_ttl_hours: number
          cod_min_collect_amount: number
          cod_quiet_hours_end: string
          cod_quiet_hours_start: string
          cod_reminder_offsets_minutes: number[]
          cod_resend_max: number
          country_code: string
          created_at: string
          financing_surcharge_pct: Json
          fx_rate_to_cop: number | null
          hide_out_of_stock: boolean
          manual_order_ttl_hours: number
          pending_payment_ttl_minutes: number
          shipping_cost_estimate: number
          support_email: string | null
          updated_at: string
        }
        Insert: {
          advisor_whatsapp?: string | null
          announcement_rotation_seconds?: number
          carrier_auto_confirm?: boolean
          carrier_discount_mode?: string
          carrier_provider?: string | null
          carrier_wallet_balance?: number | null
          carrier_wallet_balance_at?: string | null
          carrier_wallet_low_alert_at?: string | null
          carrier_wallet_low_balance?: number | null
          cod_deposit_amount?: number
          cod_enabled?: boolean
          cod_link_ttl_hours?: number
          cod_min_collect_amount?: number
          cod_quiet_hours_end?: string
          cod_quiet_hours_start?: string
          cod_reminder_offsets_minutes?: number[]
          cod_resend_max?: number
          country_code: string
          created_at?: string
          financing_surcharge_pct?: Json
          fx_rate_to_cop?: number | null
          hide_out_of_stock?: boolean
          manual_order_ttl_hours?: number
          pending_payment_ttl_minutes?: number
          shipping_cost_estimate?: number
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          advisor_whatsapp?: string | null
          announcement_rotation_seconds?: number
          carrier_auto_confirm?: boolean
          carrier_discount_mode?: string
          carrier_provider?: string | null
          carrier_wallet_balance?: number | null
          carrier_wallet_balance_at?: string | null
          carrier_wallet_low_alert_at?: string | null
          carrier_wallet_low_balance?: number | null
          cod_deposit_amount?: number
          cod_enabled?: boolean
          cod_link_ttl_hours?: number
          cod_min_collect_amount?: number
          cod_quiet_hours_end?: string
          cod_quiet_hours_start?: string
          cod_reminder_offsets_minutes?: number[]
          cod_resend_max?: number
          country_code?: string
          created_at?: string
          financing_surcharge_pct?: Json
          fx_rate_to_cop?: number | null
          hide_out_of_stock?: boolean
          manual_order_ttl_hours?: number
          pending_payment_ttl_minutes?: number
          shipping_cost_estimate?: number
          support_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_settings_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: true
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          exponent: number
          format_pattern: string
          symbol: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          exponent: number
          format_pattern: string
          symbol: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          exponent?: number
          format_pattern?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          anonymized_at: string | null
          auth_user_id: string | null
          country_code: string
          created_at: string
          document_number: string | null
          document_type: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          marketing_opt_in: boolean
          phone_e164: string | null
          updated_at: string
          whatsapp_opt_in: boolean
        }
        Insert: {
          anonymized_at?: string | null
          auth_user_id?: string | null
          country_code: string
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          phone_e164?: string | null
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Update: {
          anonymized_at?: string | null
          auth_user_id?: string | null
          country_code?: string
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          phone_e164?: string | null
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customers_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      daily_sales_stats: {
        Row: {
          carrier_platform_fees: number
          cod_collect_sent: number
          cod_deposits: number
          cod_deposits_returned: number
          confirmed_revenue: number
          country_code: string
          created_at: string
          currency_code: string
          date: string
          delivered_count: number
          delivered_value: number
          discounts: number
          gateway_fees: number
          gross_sales: number
          orders_abandoned: number
          orders_created: number
          orders_paid: number
          payment_method: string
          prepaid_sent_value: number
          product_cost: number
          recalculated_at: string
          returned_count: number
          returned_value: number
          shipping_cost: number
          shipping_estimated_count: number
          surcharges: number
          updated_at: string
          warranty_cost: number
        }
        Insert: {
          carrier_platform_fees?: number
          cod_collect_sent?: number
          cod_deposits?: number
          cod_deposits_returned?: number
          confirmed_revenue?: number
          country_code: string
          created_at?: string
          currency_code: string
          date: string
          delivered_count?: number
          delivered_value?: number
          discounts?: number
          gateway_fees?: number
          gross_sales?: number
          orders_abandoned?: number
          orders_created?: number
          orders_paid?: number
          payment_method: string
          prepaid_sent_value?: number
          product_cost?: number
          recalculated_at?: string
          returned_count?: number
          returned_value?: number
          shipping_cost?: number
          shipping_estimated_count?: number
          surcharges?: number
          updated_at?: string
          warranty_cost?: number
        }
        Update: {
          carrier_platform_fees?: number
          cod_collect_sent?: number
          cod_deposits?: number
          cod_deposits_returned?: number
          confirmed_revenue?: number
          country_code?: string
          created_at?: string
          currency_code?: string
          date?: string
          delivered_count?: number
          delivered_value?: number
          discounts?: number
          gateway_fees?: number
          gross_sales?: number
          orders_abandoned?: number
          orders_created?: number
          orders_paid?: number
          payment_method?: string
          prepaid_sent_value?: number
          product_cost?: number
          recalculated_at?: string
          returned_count?: number
          returned_value?: number
          shipping_cost?: number
          shipping_estimated_count?: number
          surcharges?: number
          updated_at?: string
          warranty_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_sales_stats_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "daily_sales_stats_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      daily_traffic_stats: {
        Row: {
          add_to_cart: number
          checkout_started: number
          country_code: string
          created_at: string
          date: string
          product_views: number
          sessions: number
          updated_at: string
        }
        Insert: {
          add_to_cart?: number
          checkout_started?: number
          country_code: string
          created_at?: string
          date: string
          product_views?: number
          sessions?: number
          updated_at?: string
        }
        Update: {
          add_to_cart?: number
          checkout_started?: number
          country_code?: string
          created_at?: string
          date?: string
          product_views?: number
          sessions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_traffic_stats_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      discount_codes: {
        Row: {
          applies_to: string
          applies_to_sale_items: boolean
          code: string
          country_code: string
          created_at: string
          ends_at: string | null
          exclude_ids: string[]
          id: string
          influencer_id: string | null
          is_active: boolean
          iza_can_offer: boolean
          max_discount_amount: number | null
          min_subtotal: number
          origin: string
          parent_code_id: string | null
          starts_at: string | null
          target_ids: string[]
          type: string
          updated_at: string
          usage_count: number
          usage_limit_per_customer: number | null
          usage_limit_total: number | null
          value: number
        }
        Insert: {
          applies_to?: string
          applies_to_sale_items?: boolean
          code: string
          country_code: string
          created_at?: string
          ends_at?: string | null
          exclude_ids?: string[]
          id?: string
          influencer_id?: string | null
          is_active?: boolean
          iza_can_offer?: boolean
          max_discount_amount?: number | null
          min_subtotal?: number
          origin?: string
          parent_code_id?: string | null
          starts_at?: string | null
          target_ids?: string[]
          type: string
          updated_at?: string
          usage_count?: number
          usage_limit_per_customer?: number | null
          usage_limit_total?: number | null
          value: number
        }
        Update: {
          applies_to?: string
          applies_to_sale_items?: boolean
          code?: string
          country_code?: string
          created_at?: string
          ends_at?: string | null
          exclude_ids?: string[]
          id?: string
          influencer_id?: string | null
          is_active?: boolean
          iza_can_offer?: boolean
          max_discount_amount?: number | null
          min_subtotal?: number
          origin?: string
          parent_code_id?: string | null
          starts_at?: string | null
          target_ids?: string[]
          type?: string
          updated_at?: string
          usage_count?: number
          usage_limit_per_customer?: number | null
          usage_limit_total?: number | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_codes_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "discount_codes_influencer_id_fkey"
            columns: ["influencer_id"]
            isOneToOne: false
            referencedRelation: "influencers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_codes_parent_code_id_fkey"
            columns: ["parent_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_redemptions: {
        Row: {
          amount: number
          created_at: string
          customer_key: string
          customer_keys: string[]
          discount_code_id: string
          id: string
          order_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_key: string
          customer_keys?: string[]
          discount_code_id: string
          id?: string
          order_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_key?: string
          customer_keys?: string[]
          discount_code_id?: string
          id?: string
          order_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemptions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          attachment_media_id: string | null
          category_id: string
          country_code: string
          created_at: string
          created_by: string | null
          currency_code: string
          date: string
          description: string | null
          external_ref: string | null
          id: string
          source: string
          updated_at: string
        }
        Insert: {
          amount: number
          attachment_media_id?: string | null
          category_id: string
          country_code: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          date: string
          description?: string | null
          external_ref?: string | null
          id?: string
          source?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          attachment_media_id?: string | null
          category_id?: string
          country_code?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          date?: string
          description?: string | null
          external_ref?: string | null
          id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_attachment_media_id_fkey"
            columns: ["attachment_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      genders: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      home_sections: {
        Row: {
          config: Json
          country_code: string
          created_at: string
          id: string
          is_active: boolean
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          country_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          country_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_sections_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      influencers: {
        Row: {
          commission_pct: number | null
          country_code: string
          created_at: string
          email: string | null
          handle: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          commission_pct?: number | null
          country_code: string
          created_at?: string
          email?: string | null
          handle?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          commission_pct?: number | null
          country_code?: string
          created_at?: string
          email?: string | null
          handle?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "influencers_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          country_code: string | null
          created_at: string
          data_encrypted: string
          environment: string
          id: string
          is_active: boolean
          iv: string
          key_version: number
          last_test_at: string | null
          last_test_message: string | null
          last_test_ok: boolean | null
          masked_preview: Json
          provider: string
          updated_at: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          data_encrypted: string
          environment: string
          id?: string
          is_active?: boolean
          iv: string
          key_version?: number
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          masked_preview?: Json
          provider: string
          updated_at?: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          data_encrypted?: string
          environment?: string
          id?: string
          is_active?: boolean
          iv?: string
          key_version?: number
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          masked_preview?: Json
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      integration_webhooks: {
        Row: {
          country_code: string | null
          created_at: string
          environment: string
          event_id: number
          event_name: string
          external_id: number
          id: string
          is_enabled: boolean
          provider: string
          registered_at: string
          updated_at: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          environment: string
          event_id: number
          event_name: string
          external_id: number
          id?: string
          is_enabled?: boolean
          provider: string
          registered_at?: string
          updated_at?: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          environment?: string
          event_id?: number
          event_name?: string
          external_id?: number
          id?: string
          is_enabled?: boolean
          provider?: string
          registered_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhooks_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      leads: {
        Row: {
          consent_at: string
          consent_text_version: string
          converted_order_id: string | null
          country_code: string
          created_at: string
          discount_code_id: string | null
          email: string | null
          id: string
          marketing_opt_in: boolean
          phone_e164: string | null
          popup_id: string | null
          updated_at: string
          utm: Json
        }
        Insert: {
          consent_at?: string
          consent_text_version: string
          converted_order_id?: string | null
          country_code: string
          created_at?: string
          discount_code_id?: string | null
          email?: string | null
          id?: string
          marketing_opt_in?: boolean
          phone_e164?: string | null
          popup_id?: string | null
          updated_at?: string
          utm?: Json
        }
        Update: {
          consent_at?: string
          consent_text_version?: string
          converted_order_id?: string | null
          country_code?: string
          created_at?: string
          discount_code_id?: string | null
          email?: string | null
          id?: string
          marketing_opt_in?: boolean
          phone_e164?: string | null
          popup_id?: string | null
          updated_at?: string
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "leads_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_popup_id_fkey"
            columns: ["popup_id"]
            isOneToOne: false
            referencedRelation: "popups"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          alt: string | null
          base_path: string
          bytes: number | null
          created_at: string
          height: number | null
          id: string
          kind: string
          lqip: string | null
          original_name: string | null
          updated_at: string
          variants: Json
          width: number | null
        }
        Insert: {
          alt?: string | null
          base_path: string
          bytes?: number | null
          created_at?: string
          height?: number | null
          id?: string
          kind: string
          lqip?: string | null
          original_name?: string | null
          updated_at?: string
          variants?: Json
          width?: number | null
        }
        Update: {
          alt?: string | null
          base_path?: string
          bytes?: number | null
          created_at?: string
          height?: number | null
          id?: string
          kind?: string
          lqip?: string | null
          original_name?: string | null
          updated_at?: string
          variants?: Json
          width?: number | null
        }
        Relationships: []
      }
      number_sequences: {
        Row: {
          country_code: string
          created_at: string
          kind: string
          last_value: number
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          kind: string
          last_value?: number
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          kind?: string
          last_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "number_sequences_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      olfactory_families: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_id: string | null
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_id?: string | null
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_id?: string | null
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olfactory_families_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor: string
          created_at: string
          from_status: string | null
          id: string
          order_id: string
          payload: Json
          to_status: string | null
          type: string
          updated_at: string
        }
        Insert: {
          actor: string
          created_at?: string
          from_status?: string | null
          id?: string
          order_id: string
          payload?: Json
          to_status?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          actor?: string
          created_at?: string
          from_status?: string | null
          id?: string
          order_id?: string
          payload?: Json
          to_status?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_discount: number
          mastershop_product_id: number | null
          mastershop_variant_id: number | null
          name_snapshot: string
          order_id: string
          product_id: string | null
          quantity: number
          sku: string
          unit_compare_at: number | null
          unit_cost: number | null
          unit_price: number
          updated_at: string
          variant_id: string | null
          variant_label: string | null
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          line_discount?: number
          mastershop_product_id?: number | null
          mastershop_variant_id?: number | null
          name_snapshot: string
          order_id: string
          product_id?: string | null
          quantity: number
          sku: string
          unit_compare_at?: number | null
          unit_cost?: number | null
          unit_price: number
          updated_at?: string
          variant_id?: string | null
          variant_label?: string | null
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          line_discount?: number
          mastershop_product_id?: number | null
          mastershop_variant_id?: number | null
          name_snapshot?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
          sku?: string
          unit_compare_at?: number | null
          unit_cost?: number | null
          unit_price?: number
          updated_at?: string
          variant_id?: string | null
          variant_label?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          abandoned_at: string | null
          alerts: Json
          cancelled_at: string | null
          carrier_fees: Json
          checkout_idempotency_key: string | null
          checkout_request_hash: string | null
          click_ids: Json
          cod_collect_amount: number
          cod_deposit_amount: number
          contact_email: string | null
          contact_first_name: string
          contact_last_name: string
          contact_phone_e164: string
          country_code: string
          created_at: string
          currency_code: string
          customer_id: string | null
          data_policy_version: string | null
          delivered_at: string | null
          discount_amount: number
          discount_code_id: string | null
          discount_code_text: string | null
          document_number: string | null
          document_type: string | null
          financing_surcharge_amount: number
          financing_surcharge_pct: number
          gateway_fee_estimated: number
          id: string
          influencer_id: string | null
          notes_internal: string | null
          number: string
          paid_at: string | null
          payment_method: string
          product_cost_total: number
          public_token: string
          sale_source: string
          sent_to_carrier_at: string | null
          shipping_address1: string | null
          shipping_address2: string | null
          shipping_city_id: string | null
          shipping_city_name: string | null
          shipping_cost_real: number | null
          shipping_district: string | null
          shipping_notes: string | null
          shipping_region_id: string | null
          shipping_region_name: string | null
          shipping_zip: string | null
          status: string
          stock_reserved_until: string | null
          stock_state: string
          subtotal: number
          terms_accepted_at: string | null
          total_customer: number
          updated_at: string
          utm: Json
          whatsapp_opt_in: boolean
        }
        Insert: {
          abandoned_at?: string | null
          alerts?: Json
          cancelled_at?: string | null
          carrier_fees?: Json
          checkout_idempotency_key?: string | null
          checkout_request_hash?: string | null
          click_ids?: Json
          cod_collect_amount?: number
          cod_deposit_amount?: number
          contact_email?: string | null
          contact_first_name: string
          contact_last_name: string
          contact_phone_e164: string
          country_code: string
          created_at?: string
          currency_code: string
          customer_id?: string | null
          data_policy_version?: string | null
          delivered_at?: string | null
          discount_amount?: number
          discount_code_id?: string | null
          discount_code_text?: string | null
          document_number?: string | null
          document_type?: string | null
          financing_surcharge_amount?: number
          financing_surcharge_pct?: number
          gateway_fee_estimated?: number
          id?: string
          influencer_id?: string | null
          notes_internal?: string | null
          number?: string
          paid_at?: string | null
          payment_method: string
          product_cost_total?: number
          public_token?: string
          sale_source?: string
          sent_to_carrier_at?: string | null
          shipping_address1?: string | null
          shipping_address2?: string | null
          shipping_city_id?: string | null
          shipping_city_name?: string | null
          shipping_cost_real?: number | null
          shipping_district?: string | null
          shipping_notes?: string | null
          shipping_region_id?: string | null
          shipping_region_name?: string | null
          shipping_zip?: string | null
          status: string
          stock_reserved_until?: string | null
          stock_state?: string
          subtotal: number
          terms_accepted_at?: string | null
          total_customer: number
          updated_at?: string
          utm?: Json
          whatsapp_opt_in?: boolean
        }
        Update: {
          abandoned_at?: string | null
          alerts?: Json
          cancelled_at?: string | null
          carrier_fees?: Json
          checkout_idempotency_key?: string | null
          checkout_request_hash?: string | null
          click_ids?: Json
          cod_collect_amount?: number
          cod_deposit_amount?: number
          contact_email?: string | null
          contact_first_name?: string
          contact_last_name?: string
          contact_phone_e164?: string
          country_code?: string
          created_at?: string
          currency_code?: string
          customer_id?: string | null
          data_policy_version?: string | null
          delivered_at?: string | null
          discount_amount?: number
          discount_code_id?: string | null
          discount_code_text?: string | null
          document_number?: string | null
          document_type?: string | null
          financing_surcharge_amount?: number
          financing_surcharge_pct?: number
          gateway_fee_estimated?: number
          id?: string
          influencer_id?: string | null
          notes_internal?: string | null
          number?: string
          paid_at?: string | null
          payment_method?: string
          product_cost_total?: number
          public_token?: string
          sale_source?: string
          sent_to_carrier_at?: string | null
          shipping_address1?: string | null
          shipping_address2?: string | null
          shipping_city_id?: string | null
          shipping_city_name?: string | null
          shipping_cost_real?: number | null
          shipping_district?: string | null
          shipping_notes?: string | null
          shipping_region_id?: string | null
          shipping_region_name?: string | null
          shipping_zip?: string | null
          status?: string
          stock_reserved_until?: string | null
          stock_state?: string
          subtotal?: number
          terms_accepted_at?: string | null
          total_customer?: number
          updated_at?: string
          utm?: Json
          whatsapp_opt_in?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "orders_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_influencer_id_fkey"
            columns: ["influencer_id"]
            isOneToOne: false
            referencedRelation: "influencers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shipping_city_id_fkey"
            columns: ["shipping_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shipping_region_id_fkey"
            columns: ["shipping_region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          content_html: string
          country_code: string
          created_at: string
          id: string
          kind: string
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          content_html?: string
          country_code: string
          created_at?: string
          id?: string
          kind?: string
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          content_html?: string
          country_code?: string
          created_at?: string
          id?: string
          kind?: string
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pages_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      pay_links: {
        Row: {
          clicks: number
          created_at: string
          expires_at: string
          order_id: string
          payment_id: string | null
          target_url: string
          token: string
          updated_at: string
        }
        Insert: {
          clicks?: number
          created_at?: string
          expires_at: string
          order_id: string
          payment_id?: string | null
          target_url: string
          token: string
          updated_at?: string
        }
        Update: {
          clicks?: number
          created_at?: string
          expires_at?: string
          order_id?: string
          payment_id?: string | null
          target_url?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_links_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_method_settings: {
        Row: {
          country_code: string
          created_at: string
          description: string | null
          display_name: string
          fee_fixed: number
          fee_pct: number
          fee_tax_pct: number
          is_enabled: boolean
          method: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          description?: string | null
          display_name: string
          fee_fixed?: number
          fee_pct?: number
          fee_tax_pct?: number
          is_enabled?: boolean
          method: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          fee_fixed?: number
          fee_pct?: number
          fee_tax_pct?: number
          is_enabled?: boolean
          method?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_settings_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          checkout_url: string | null
          created_at: string
          currency_code: string
          expires_at: string | null
          fee_amount: number | null
          id: string
          order_id: string
          payment_link_id: string | null
          provider: string
          provider_reference: string | null
          provider_transaction_id: string | null
          purpose: string
          raw_last_event: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          checkout_url?: string | null
          created_at?: string
          currency_code: string
          expires_at?: string | null
          fee_amount?: number | null
          id?: string
          order_id: string
          payment_link_id?: string | null
          provider: string
          provider_reference?: string | null
          provider_transaction_id?: string | null
          purpose: string
          raw_last_event?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          checkout_url?: string | null
          created_at?: string
          currency_code?: string
          expires_at?: string | null
          fee_amount?: number | null
          id?: string
          order_id?: string
          payment_link_id?: string | null
          provider?: string
          provider_reference?: string | null
          provider_transaction_id?: string | null
          purpose?: string
          raw_last_event?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      popups: {
        Row: {
          body: string | null
          capture_lead: boolean
          country_code: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          device: string
          discount_code_id: string | null
          ends_at: string | null
          frequency: string
          frequency_days: number | null
          id: string
          is_active: boolean
          lead_reward: string | null
          media_id: string | null
          name: string
          pages: string[]
          priority: number
          starts_at: string | null
          title: string | null
          trigger: string
          trigger_value: number | null
          unique_code_template: Json | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          capture_lead?: boolean
          country_code: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          device?: string
          discount_code_id?: string | null
          ends_at?: string | null
          frequency?: string
          frequency_days?: number | null
          id?: string
          is_active?: boolean
          lead_reward?: string | null
          media_id?: string | null
          name: string
          pages?: string[]
          priority?: number
          starts_at?: string | null
          title?: string | null
          trigger?: string
          trigger_value?: number | null
          unique_code_template?: Json | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          capture_lead?: boolean
          country_code?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          device?: string
          discount_code_id?: string | null
          ends_at?: string | null
          frequency?: string
          frequency_days?: number | null
          id?: string
          is_active?: boolean
          lead_reward?: string | null
          media_id?: string | null
          name?: string
          pages?: string[]
          priority?: number
          starts_at?: string | null
          title?: string | null
          trigger?: string
          trigger_value?: number | null
          unique_code_template?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "popups_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "popups_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "popups_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      print_agents: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_heartbeat_at: string | null
          mode: string
          name: string
          printer_name: string | null
          remote_config: Json
          status_payload: Json
          token_hash: string
          updated_at: string
          version: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_heartbeat_at?: string | null
          mode?: string
          name: string
          printer_name?: string | null
          remote_config?: Json
          status_payload?: Json
          token_hash: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_heartbeat_at?: string | null
          mode?: string
          name?: string
          printer_name?: string | null
          remote_config?: Json
          status_payload?: Json
          token_hash?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      print_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by_agent: string | null
          created_at: string
          error: string | null
          id: string
          order_id: string | null
          printed_at: string | null
          requested_by: string
          shipment_id: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by_agent?: string | null
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          printed_at?: string | null
          requested_by?: string
          shipment_id?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by_agent?: string | null
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          printed_at?: string | null
          requested_by?: string
          shipment_id?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_claimed_by_agent_fkey"
            columns: ["claimed_by_agent"]
            isOneToOne: false
            referencedRelation: "print_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          product_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_countries: {
        Row: {
          badges: string[]
          country_code: string
          created_at: string
          featured_rank: number | null
          is_featured: boolean
          is_visible: boolean
          product_id: string
          published_at: string | null
          updated_at: string
        }
        Insert: {
          badges?: string[]
          country_code: string
          created_at?: string
          featured_rank?: number | null
          is_featured?: boolean
          is_visible?: boolean
          product_id: string
          published_at?: string | null
          updated_at?: string
        }
        Update: {
          badges?: string[]
          country_code?: string
          created_at?: string
          featured_rank?: number | null
          is_featured?: boolean
          is_visible?: boolean
          product_id?: string
          published_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_countries_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_countries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string
          media_id: string
          product_id: string
          role: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          media_id: string
          product_id: string
          role?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          media_id?: string
          product_id?: string
          role?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_option_values: {
        Row: {
          created_at: string
          id: string
          option_id: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_option_values_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
        ]
      }
      product_options: {
        Row: {
          created_at: string
          id: string
          name: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_options_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: string
          image_id: string | null
          is_default: boolean
          mastershop_product_id: number | null
          mastershop_variant_id: number | null
          option_value_ids: string[]
          product_id: string
          sku: string
          sort_order: number
          updated_at: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_id?: string | null
          is_default?: boolean
          mastershop_product_id?: number | null
          mastershop_variant_id?: number | null
          option_value_ids?: string[]
          product_id: string
          sku: string
          sort_order?: number
          updated_at?: string
          weight_kg?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_id?: string | null
          is_default?: boolean
          mastershop_product_id?: number | null
          mastershop_variant_id?: number | null
          option_value_ids?: string[]
          product_id?: string
          sku?: string
          sort_order?: number
          updated_at?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json
          brand_id: string | null
          concentration_id: string | null
          created_at: string
          description_html: string | null
          family_id: string | null
          gender_id: string | null
          id: string
          longevity: string | null
          name: string
          notes_base: string[]
          notes_heart: string[]
          notes_top: string[]
          occasion: string[]
          season: string[]
          seo_description: string | null
          seo_title: string | null
          short_description: string | null
          sillage: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          attributes?: Json
          brand_id?: string | null
          concentration_id?: string | null
          created_at?: string
          description_html?: string | null
          family_id?: string | null
          gender_id?: string | null
          id?: string
          longevity?: string | null
          name: string
          notes_base?: string[]
          notes_heart?: string[]
          notes_top?: string[]
          occasion?: string[]
          season?: string[]
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          sillage?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          attributes?: Json
          brand_id?: string | null
          concentration_id?: string | null
          created_at?: string
          description_html?: string | null
          family_id?: string | null
          gender_id?: string | null
          id?: string
          longevity?: string | null
          name?: string
          notes_base?: string[]
          notes_heart?: string[]
          notes_top?: string[]
          occasion?: string[]
          season?: string[]
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          sillage?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_concentration_id_fkey"
            columns: ["concentration_id"]
            isOneToOne: false
            referencedRelation: "concentrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "olfactory_families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_gender_id_fkey"
            columns: ["gender_id"]
            isOneToOne: false
            referencedRelation: "genders"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          code: string
          country_code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          country_code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          country_code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regions_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      reviews: {
        Row: {
          author_name: string
          body: string | null
          city: string | null
          country_code: string
          created_at: string
          featured_home: boolean
          id: string
          is_verified_purchase: boolean
          media_ids: string[]
          order_id: string | null
          product_id: string | null
          rating: number
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          author_name: string
          body?: string | null
          city?: string | null
          country_code: string
          created_at?: string
          featured_home?: boolean
          id?: string
          is_verified_purchase?: boolean
          media_ids?: string[]
          order_id?: string | null
          product_id?: string | null
          rating: number
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          author_name?: string
          body?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          featured_home?: boolean
          id?: string
          is_verified_purchase?: boolean
          media_ids?: string[]
          order_id?: string | null
          product_id?: string | null
          rating?: number
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          alerts: Json
          carrier_name: string | null
          created_at: string
          external_order_id: string
          has_novelty: boolean
          id: string
          label_local_path: string | null
          label_url: string | null
          last_synced_at: string | null
          order_id: string
          provider: string
          provider_order_id: number | null
          provider_status_id: number | null
          provider_status_name: string | null
          provider_status_parent: string | null
          shipping_rate: number | null
          status_history: Json
          total_provider: number | null
          tracking_code: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          alerts?: Json
          carrier_name?: string | null
          created_at?: string
          external_order_id: string
          has_novelty?: boolean
          id?: string
          label_local_path?: string | null
          label_url?: string | null
          last_synced_at?: string | null
          order_id: string
          provider?: string
          provider_order_id?: number | null
          provider_status_id?: number | null
          provider_status_name?: string | null
          provider_status_parent?: string | null
          shipping_rate?: number | null
          status_history?: Json
          total_provider?: number | null
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          alerts?: Json
          carrier_name?: string | null
          created_at?: string
          external_order_id?: string
          has_novelty?: boolean
          id?: string
          label_local_path?: string | null
          label_url?: string | null
          last_synced_at?: string | null
          order_id?: string
          provider?: string
          provider_order_id?: number | null
          provider_status_id?: number | null
          provider_status_name?: string | null
          provider_status_parent?: string | null
          shipping_rate?: number | null
          status_history?: Json
          total_provider?: number | null
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          audit_retention_days: number
          color_tokens: Json
          created_at: string
          favicon_media_id: string | null
          id: boolean
          legal_info: Json
          logo_media_id: string | null
          og_image_media_id: string | null
          social_links: Json
          store_name: string
          typography: Json
          updated_at: string
        }
        Insert: {
          audit_retention_days?: number
          color_tokens?: Json
          created_at?: string
          favicon_media_id?: string | null
          id?: boolean
          legal_info?: Json
          logo_media_id?: string | null
          og_image_media_id?: string | null
          social_links?: Json
          store_name: string
          typography?: Json
          updated_at?: string
        }
        Update: {
          audit_retention_days?: number
          color_tokens?: Json
          created_at?: string
          favicon_media_id?: string | null
          id?: boolean
          legal_info?: Json
          logo_media_id?: string | null
          og_image_media_id?: string | null
          social_links?: Json
          store_name?: string
          typography?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_settings_favicon_media_id_fkey"
            columns: ["favicon_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_settings_logo_media_id_fkey"
            columns: ["logo_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_settings_og_image_media_id_fkey"
            columns: ["og_image_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_overrides: {
        Row: {
          country_code: string
          created_at: string
          tokens: Json
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          tokens?: Json
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          tokens?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_overrides_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: true
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      variant_countries: {
        Row: {
          compare_at_price: number | null
          cost: number | null
          country_code: string
          created_at: string
          is_active: boolean
          low_stock_threshold: number | null
          price: number
          stock: number
          stock_reserved: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          compare_at_price?: number | null
          cost?: number | null
          country_code: string
          created_at?: string
          is_active?: boolean
          low_stock_threshold?: number | null
          price: number
          stock?: number
          stock_reserved?: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          compare_at_price?: number | null
          cost?: number | null
          country_code?: string
          created_at?: string
          is_active?: boolean
          low_stock_threshold?: number | null
          price?: number
          stock?: number
          stock_reserved?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_countries_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "variant_countries_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      warranty_claims: {
        Row: {
          admin_notes: string | null
          cost_amount: number
          country_code: string
          created_at: string
          customer_name: string
          description: string | null
          email: string | null
          id: string
          media_ids: string[]
          number: string
          order_id: string | null
          phone: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          status: string
          status_history: Json
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          cost_amount?: number
          country_code: string
          created_at?: string
          customer_name: string
          description?: string | null
          email?: string | null
          id?: string
          media_ids?: string[]
          number?: string
          order_id?: string | null
          phone: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          status_history?: Json
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          cost_amount?: number
          country_code?: string
          created_at?: string
          customer_name?: string
          description?: string | null
          email?: string | null
          id?: string
          media_ids?: string[]
          number?: string
          order_id?: string | null
          phone?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          status_history?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warranty_claims_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "warranty_claims_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      warranty_settings: {
        Row: {
          conditions_html: string
          country_code: string
          created_at: string
          instructions_html: string
          period_days: number
          reasons: string[]
          response_days: number
          updated_at: string
        }
        Insert: {
          conditions_html?: string
          country_code: string
          created_at?: string
          instructions_html?: string
          period_days?: number
          reasons?: string[]
          response_days?: number
          updated_at?: string
        }
        Update: {
          conditions_html?: string
          country_code?: string
          created_at?: string
          instructions_html?: string
          period_days?: number
          reasons?: string[]
          response_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warranty_settings_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: true
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          signature_valid: boolean | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id: string
          id?: string
          payload: Json
          processed_at?: string | null
          provider: string
          signature_valid?: boolean | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          signature_valid?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          created_at: string
          error_code: string | null
          error_text: string | null
          id: string
          order_id: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          template_id: string | null
          to_e164: string
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_text?: string | null
          id?: string
          order_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string | null
          to_e164: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_text?: string | null
          id?: string
          order_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string | null
          to_e164?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body_text: string
          button_text: string | null
          button_url: string | null
          category: string
          country_code: string
          created_at: string
          footer_text: string | null
          id: string
          is_active: boolean
          key: string
          language: string
          meta_rejection_reason: string | null
          meta_status: string
          meta_template_id: string | null
          meta_template_name: string
          updated_at: string
          variables_map: Json
          version: number
        }
        Insert: {
          body_text: string
          button_text?: string | null
          button_url?: string | null
          category?: string
          country_code: string
          created_at?: string
          footer_text?: string | null
          id?: string
          is_active?: boolean
          key: string
          language?: string
          meta_rejection_reason?: string | null
          meta_status?: string
          meta_template_id?: string | null
          meta_template_name: string
          updated_at?: string
          variables_map?: Json
          version?: number
        }
        Update: {
          body_text?: string
          button_text?: string | null
          button_url?: string | null
          category?: string
          country_code?: string
          created_at?: string
          footer_text?: string | null
          id?: string
          is_active?: boolean
          key?: string
          language?: string
          meta_rejection_reason?: string | null
          meta_status?: string
          meta_template_id?: string | null
          meta_template_name?: string
          updated_at?: string
          variables_map?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          customer_id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activar_credencial_integracion: { Args: { p_id: string }; Returns: Json }
      activar_plantilla_whatsapp: {
        Args: { p_id: string; p_meta_template_id?: string }
        Returns: Json
      }
      admin_entero: { Args: { campo: string; v: Json }; Returns: number }
      admin_guardar_producto: { Args: { p: Json }; Returns: Json }
      admin_importar_catalogo: { Args: { p: Json }; Returns: Json }
      admin_producto_estado: { Args: { p_product_id: string }; Returns: Json }
      admin_sync_producto_interno: {
        Args: { p: Json; p_completo: boolean }
        Returns: Json
      }
      admin_textos: { Args: { v: Json }; Returns: string[] }
      aplicar_transicion_pedido: { Args: { p: Json }; Returns: Json }
      catalog_item_json: {
        Args: { cl: Database["public"]["Tables"]["catalog_listing"]["Row"] }
        Returns: Json
      }
      catalog_page: {
        Args: {
          p_country: string
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_sort?: string
        }
        Returns: Json
      }
      catalog_product: {
        Args: { p_country: string; p_slug: string }
        Returns: Json
      }
      catalog_query_interno: {
        Args: {
          p_country: string
          p_cursor: Json
          p_filters: Json
          p_limit: number
          p_q: string
          p_sort: string
        }
        Returns: Json
      }
      catalog_related: {
        Args: { p_country: string; p_limit?: number; p_product_id: string }
        Returns: Json
      }
      catalog_search_page: {
        Args: {
          p_country: string
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_q: string
          p_sort?: string
        }
        Returns: Json
      }
      catalog_suggest: {
        Args: { p_country: string; p_limit?: number; p_q: string }
        Returns: Json
      }
      claves_cliente: {
        Args: { p_celular: string; p_correo: string; p_documento: string }
        Returns: string[]
      }
      confirmar_canje: { Args: { p_order_id: string }; Returns: Json }
      confirmar_stock: { Args: { p_order_id: string }; Returns: Json }
      crear_pedido_checkout: { Args: { p: Json }; Returns: Json }
      f_unaccent: { Args: { p_text: string }; Returns: string }
      fuente_venta: {
        Args: { p_click_ids: Json; p_utm: Json }
        Returns: string
      }
      liberar_canje: { Args: { p_order_id: string }; Returns: Json }
      liberar_stock: { Args: { p_order_id: string }; Returns: Json }
      media_json: {
        Args: { m: Database["public"]["Tables"]["media"]["Row"] }
        Returns: Json
      }
      metricas_estados_pagados: { Args: never; Returns: string[] }
      metricas_panel_guias: {
        Args: { p_desde: string; p_hasta: string; p_pais: string }
        Returns: {
          cantidad: number
          dimension: string
          estado: string
          grupo: string
        }[]
      }
      metricas_periodo: {
        Args: {
          p_desde: string
          p_hasta: string
          p_limite?: number
          p_pais: string
        }
        Returns: Record<string, unknown>
      }
      metricas_top_agrupado: {
        Args: {
          p_desde: string
          p_dimension: string
          p_hasta: string
          p_limite?: number
          p_pais: string
        }
        Returns: {
          clave: string
          etiqueta: string
          ingresos_confirmados: number
          pagados: number
          pedidos: number
          ventas_brutas: number
        }[]
      }
      metricas_top_ciudades: {
        Args: {
          p_desde: string
          p_hasta: string
          p_limite?: number
          p_pais: string
        }
        Returns: {
          ciudad: string
          departamento: string
          devueltos: number
          entregados: number
          pedidos: number
          ventas_brutas: number
        }[]
      }
      metricas_top_departamentos: {
        Args: {
          p_desde: string
          p_hasta: string
          p_limite?: number
          p_pais: string
        }
        Returns: {
          departamento: string
          devueltos: number
          entregados: number
          pedidos: number
          ventas_brutas: number
        }[]
      }
      metricas_top_productos: {
        Args: {
          p_desde: string
          p_hasta: string
          p_limite?: number
          p_pais: string
        }
        Returns: {
          costo: number
          nombre: string
          producto_id: string
          sku: string
          unidades: number
          unidades_sin_costo: number
          utilidad: number
          ventas: number
        }[]
      }
      next_document_number: {
        Args: { p_country_code: string; p_kind: string }
        Returns: number
      }
      pay_link_click: { Args: { p_token: string }; Returns: Json }
      pedido_checkout_existente:
        | { Args: { p_clave: string; p_pais: string }; Returns: Json }
        | {
            Args: { p_clave: string; p_hash: string; p_pais: string }
            Returns: Json
          }
      pedido_checkout_resumen: { Args: { p_order_id: string }; Returns: Json }
      pedidos_por_vencer: {
        Args: { p_ahora?: string; p_limite?: number }
        Returns: {
          country_code: string
          estado_actual: string
          nuevo_estado: string
          number: string
          order_id: string
          payment_method: string
          stock_reserved_until: string
          stock_state: string
          tiene_codigo: boolean
        }[]
      }
      politica_datos_vigente: { Args: { p_pais: string }; Returns: string }
      purgar_audit_log: { Args: { p_dias?: number }; Returns: number }
      refresh_catalog_listing: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      refresh_catalog_listing_all: { Args: never; Returns: number }
      refresh_catalog_listing_many: {
        Args: { p_product_ids: string[] }
        Returns: number
      }
      reservar_canje: { Args: { p_order_id: string }; Returns: Json }
      reservar_stock: { Args: { p_order_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
