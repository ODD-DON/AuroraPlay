-- Resale Radar core schema.
-- Money is stored as integer cents. Rates are integer basis points.
-- Every owned row carries owner_id and is protected by row-level security.
-- Runs unchanged on Supabase Postgres and on the local embedded Postgres (PGlite),
-- which receives a small auth shim first (see src/server/db/local-auth-shim.sql).

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table user_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table user_roles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'viewer')),
  primary key (owner_id, role)
);

-- Business settings (validated by zod on every write) and onboarding state.
create table application_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  onboarding_completed boolean not null default false,
  fee_schedule_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table user_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
  notification_channels jsonb not null default '{"in_app": true, "email": false, "push": false, "sms": false}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------
create table integration_capabilities (
  provider text not null,
  capability text not null,
  supported text not null check (supported in ('official', 'restricted', 'paid', 'unavailable', 'manual')),
  notes text not null default '',
  verified_at date,
  primary key (provider, capability)
);

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  status text not null default 'not_configured' check (status in ('connected', 'disconnected', 'error', 'not_configured', 'expired')),
  scopes text[] not null default '{}',
  -- AES-GCM ciphertext produced server-side. Never returned to the client.
  encrypted_credentials text,
  token_expires_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

create table integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  kind text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  items_processed integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table integration_errors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index integration_errors_recent on integration_errors (owner_id, occurred_at desc);

create table data_source_status (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  healthy boolean not null,
  detail text not null default '',
  checked_at timestamptz not null default now(),
  primary key (owner_id, provider)
);

create table api_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  operation text not null,
  units integer not null default 1,
  -- Millionths of a dollar so sub-cent AI and routing calls stay exact.
  cost_microdollars integer not null default 0 check (cost_microdollars >= 0),
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
create index api_usage_month on api_usage (owner_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Search and discovery
-- ---------------------------------------------------------------------------
create table search_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  sources text[] not null default '{}',
  categories text[] not null default '{}',
  keywords text[] not null default '{}',
  exclusions text[] not null default '{}',
  min_price_cents integer check (min_price_cents >= 0),
  max_price_cents integer check (max_price_cents >= 0),
  max_travel_minutes integer check (max_travel_minutes > 0),
  min_roi_bps integer check (min_roi_bps >= 0),
  min_net_profit_cents integer check (min_net_profit_cents >= 0),
  required_evidence text not null default 'moderate' check (required_evidence in ('any', 'thin', 'moderate', 'strong')),
  conditions text[] not null default '{}',
  poll_minutes integer not null default 60 check (poll_minutes >= 5),
  notify jsonb not null default '{"in_app": true}'::jsonb,
  ai_suggested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table search_executions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  search_profile_id uuid references search_profiles(id) on delete set null,
  source text not null,
  ring_tier text,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  results_count integer not null default 0,
  new_count integer not null default 0,
  cost_microdollars integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index search_executions_profile on search_executions (owner_id, search_profile_id, started_at desc);

create table source_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  external_id text,
  canonical_url text,
  title text not null,
  description text,
  asking_price_cents integer check (asking_price_cents >= 0),
  currency text not null default 'USD',
  category text,
  condition text,
  seller_name text,
  seller_reputation jsonb,
  location_text text,
  location_precision text not null default 'unknown' check (location_precision in ('exact', 'approximate', 'unknown')),
  latitude double precision,
  longitude double precision,
  listed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  shipping_available boolean,
  shipping_price_cents integer,
  status text not null default 'active' check (status in ('active', 'pending', 'sold', 'expired', 'unavailable', 'unknown')),
  source_confidence numeric(3, 2) check (source_confidence between 0 and 1),
  import_method text not null check (import_method in ('url', 'screenshot', 'manual', 'api', 'share', 'notification')),
  fingerprint jsonb not null default '{}'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index source_listings_external on source_listings (owner_id, source, external_id) where external_id is not null;
create unique index source_listings_url on source_listings (owner_id, canonical_url) where canonical_url is not null;
create index source_listings_seen on source_listings (owner_id, last_observed_at desc);

create table listing_images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references source_listings(id) on delete cascade,
  storage_path text,
  source_url text,
  origin text not null check (origin in ('user_upload', 'api', 'screenshot', 'share')),
  mime_type text,
  width integer,
  height integer,
  phash text,
  sha256 text,
  position smallint not null default 0,
  retention_until timestamptz,
  created_at timestamptz not null default now()
);
create index listing_images_listing on listing_images (listing_id, position);

create table listing_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references source_listings(id) on delete cascade,
  price_cents integer not null check (price_cents >= 0),
  observed_at timestamptz not null default now()
);
create index listing_price_history_listing on listing_price_history (listing_id, observed_at);

create table listing_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references source_listings(id) on delete cascade,
  status text not null,
  price_cents integer,
  raw jsonb,
  observed_at timestamptz not null default now()
);

create table listing_deduplication_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references source_listings(id) on delete cascade,
  duplicate_of_id uuid not null references source_listings(id) on delete cascade,
  kind text not null check (kind in ('same_listing', 'relist_or_crosspost', 'possible')),
  signals jsonb not null default '[]'::jsonb,
  score numeric(4, 3) not null,
  confirmed_by_user boolean,
  created_at timestamptz not null default now(),
  unique (listing_id, duplicate_of_id),
  check (listing_id <> duplicate_of_id)
);

-- ---------------------------------------------------------------------------
-- Opportunities (the evaluated deal; one per listing)
-- ---------------------------------------------------------------------------
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references source_listings(id) on delete set null,
  title text not null,
  category text,
  status text not null default 'discovered' check (status in (
    'discovered', 'identified', 'researching', 'verified', 'qualified', 'negotiating', 'purchased', 'listed', 'sold',
    'passed', 'expired', 'sold_by_other', 'suspicious', 'research_required', 'unavailable', 'duplicate')),
  decision text check (decision in ('STRONG_BUY', 'BUY_IF_NEGOTIATED', 'WORTH_THE_DRIVE', 'HIDDEN_GEM', 'RESEARCH_REQUIRED', 'PASS', 'UNAVAILABLE')),
  requires_manual_review boolean not null default false,
  score smallint check (score between 0 and 100),
  asking_price_cents integer not null check (asking_price_cents >= 0),
  max_purchase_cents integer,
  conservative_net_cents integer,
  base_net_cents integer,
  conservative_roi_bps integer,
  one_way_minutes integer,
  identity_status text not null default 'unverified' check (identity_status in ('verified', 'probable', 'unverified')),
  identity_confidence numeric(3, 2) not null default 0 check (identity_confidence between 0 and 1),
  authenticity_status text not null default 'unverified' check (authenticity_status in ('verified', 'not_required', 'unverified', 'failed')),
  condition_confidence numeric(3, 2) not null default 0.5 check (condition_confidence between 0 and 1),
  functionality_tested boolean not null default false,
  hidden_gem_flag boolean not null default false,
  hidden_gem_rationale text,
  hidden_gem_potential_high_cents integer,
  rare_item boolean not null default false,
  channel text not null default 'ebay_us' check (channel in ('ebay_us', 'local_cash')),
  shipping_label_cents integer not null default 0 check (shipping_label_cents >= 0),
  packaging_cents integer check (packaging_cents >= 0),
  inbound_shipping_cents integer not null default 0 check (inbound_shipping_cents >= 0),
  repair_estimate_cents integer not null default 0 check (repair_estimate_cents >= 0),
  pickup_minutes integer check (pickup_minutes >= 0),
  notes text,
  evaluation_version integer not null default 0,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunities_feed on opportunities (owner_id, status, score desc);
create index opportunities_decision on opportunities (owner_id, decision);

create table opportunity_evaluations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  version integer not null,
  decision text not null,
  score smallint not null,
  engine_version text not null,
  input jsonb not null,
  result jsonb not null,
  computed_at timestamptz not null default now(),
  unique (opportunity_id, version)
);

create table opportunity_scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid not null references opportunity_evaluations(id) on delete cascade,
  name text not null check (name in ('conservative', 'base', 'optimistic')),
  net_profit_cents integer not null,
  cash_roi_bps integer,
  data jsonb not null,
  unique (evaluation_id, name)
);

create table opportunity_risk_factors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  code text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  detail text not null default '',
  allowance_bps integer not null default 0,
  resolved boolean not null default false,
  source text not null default 'user' check (source in ('user', 'ai', 'system')),
  created_at timestamptz not null default now(),
  unique (opportunity_id, code)
);

create table opportunity_status_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create table user_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  decision text not null check (decision in ('pursue', 'pass', 'save', 'purchase')),
  system_decision text,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Identification
-- ---------------------------------------------------------------------------
create table detected_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references source_listings(id) on delete cascade,
  image_id uuid references listing_images(id) on delete set null,
  label text not null,
  bbox jsonb,
  detection_confidence numeric(3, 2) check (detection_confidence between 0 and 1),
  research_priority smallint not null default 50 check (research_priority between 0 and 100),
  status text not null default 'candidate' check (status in ('candidate', 'researching', 'confirmed', 'dismissed')),
  ai_run_id uuid,
  created_at timestamptz not null default now()
);

create table item_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  listing_id uuid references source_listings(id) on delete cascade,
  detected_object_id uuid references detected_objects(id) on delete cascade,
  brand text,
  product_name text not null,
  model text,
  generation text,
  manufacturing_period text,
  variant text,
  material text,
  category text,
  collector_designation text,
  identification_confidence numeric(3, 2) not null check (identification_confidence between 0 and 1),
  variant_confidence numeric(3, 2) check (variant_confidence between 0 and 1),
  authenticity_concerns text,
  rationale text,
  potential_value_low_cents integer,
  potential_value_high_cents integer,
  required_photos text[] not null default '{}',
  status text not null default 'hypothesis' check (status in ('hypothesis', 'confirmed', 'rejected')),
  source text not null default 'ai' check (source in ('ai', 'user')),
  ai_run_id uuid,
  created_at timestamptz not null default now()
);

create table identity_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references item_identity_candidates(id) on delete cascade,
  kind text not null check (kind in ('visual_feature', 'marking', 'serial', 'reference', 'conflict', 'expert_opinion', 'document')),
  description text not null,
  supports boolean not null default true,
  image_id uuid references listing_images(id) on delete set null,
  url text,
  created_at timestamptz not null default now()
);

create table identification_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references item_identity_candidates(id) on delete cascade,
  decision text not null check (decision in ('confirmed', 'rejected', 'corrected')),
  correction jsonb,
  notes text,
  reviewed_at timestamptz not null default now()
);

create table authenticity_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  method text not null,
  result text not null check (result in ('verified', 'failed', 'pending', 'not_required')),
  evidence_url text,
  notes text,
  checked_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Market research
-- ---------------------------------------------------------------------------
create table comparable_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_key text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, product_key)
);

create table comparable_sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  group_id uuid references comparable_groups(id) on delete set null,
  product_identity text not null,
  source text not null,
  source_url text,
  sale_date date,
  price_cents integer not null check (price_cents >= 0),
  shipping_cents integer check (shipping_cents >= 0),
  total_price_cents integer not null check (total_price_cents >= 0),
  currency text not null default 'USD',
  condition text,
  variant text,
  accessories text,
  grade text,
  evidence_type text not null check (evidence_type in ('sold_verified', 'sold_user_recorded', 'completed_uncertain', 'active_listing', 'price_guide', 'auction_estimate', 'ai_estimate')),
  match_confidence numeric(3, 2) not null check (match_confidence between 0 and 1),
  variant_match boolean not null default true,
  condition_match text not null default 'unknown' check (condition_match in ('exact', 'better', 'worse', 'unknown')),
  excluded boolean not null default false,
  notes text,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index comparable_sales_opportunity on comparable_sales (opportunity_id);

create table comparable_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  comparable_id uuid not null references comparable_sales(id) on delete cascade,
  kind text not null check (kind in ('screenshot', 'url', 'note')),
  storage_path text,
  content text,
  created_at timestamptz not null default now()
);

create table market_valuations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  version integer not null,
  conservative_cents integer,
  base_cents integer,
  optimistic_cents integer,
  sample_size integer not null,
  evidence_strength text not null,
  data jsonb not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (opportunity_id, version)
);

create table liquidity_estimates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  sold_count_90d integer check (sold_count_90d >= 0),
  active_count integer check (active_count >= 0),
  source text not null default 'user',
  source_url text,
  observed_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index liquidity_estimates_latest on liquidity_estimates (opportunity_id, observed_at desc);

create table valuation_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  previous_conservative_cents integer,
  new_conservative_cents integer,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Geography
-- ---------------------------------------------------------------------------
create table pickup_locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  -- Private. Never rendered outside the owner's settings page.
  address_private text,
  latitude double precision,
  longitude double precision,
  precision text not null default 'approximate' check (precision in ('exact', 'approximate', 'unknown')),
  is_home boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index pickup_locations_one_home on pickup_locations (owner_id) where is_home;

create table route_estimates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  source text not null check (source in ('google_routes', 'manual', 'shipped', 'unknown')),
  precision text not null check (precision in ('exact', 'approximate', 'unknown')),
  traffic_aware boolean not null default false,
  one_way_minutes integer check (one_way_minutes >= 0),
  one_way_miles numeric(7, 2) check (one_way_miles >= 0),
  tolls_cents integer not null default 0,
  parking_cents integer not null default 0,
  destination_text text,
  raw jsonb,
  computed_at timestamptz not null default now()
);
create index route_estimates_latest on route_estimates (opportunity_id, computed_at desc);

create table pickup_trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  scheduled_for timestamptz,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  total_minutes integer,
  total_miles numeric(7, 2),
  trip_cost_cents integer,
  plan jsonb,
  created_at timestamptz not null default now()
);

create table pickup_trip_stops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references pickup_trips(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  sequence smallint,
  window_start timestamptz,
  window_end timestamptz,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'completed', 'skipped')),
  allocated_cost_cents integer,
  cash_needed_cents integer,
  payment_method text,
  notes text,
  unique (trip_id, opportunity_id)
);

-- ---------------------------------------------------------------------------
-- Negotiation
-- ---------------------------------------------------------------------------
create table negotiations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null unique references opportunities(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'contacted', 'offer_sent', 'countered', 'agreed', 'declined', 'sold_elsewhere', 'abandoned')),
  opening_offer_cents integer,
  target_price_cents integer,
  max_price_cents integer,
  agreed_price_cents integer,
  proposed_pickup_at timestamptz,
  pickup_place text,
  agreed_details text,
  seller_preferences text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (agreed_price_cents is null or max_price_cents is null or agreed_price_cents <= max_price_cents)
);

create table negotiation_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  negotiation_id uuid not null references negotiations(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null,
  status text not null check (status in ('draft', 'approved', 'sent_manually', 'sent', 'received', 'discarded')),
  channel text not null default 'manual',
  generated_by text not null default 'template' check (generated_by in ('template', 'ai', 'user', 'seller')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  negotiation_id uuid not null references negotiations(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  conservative_net_cents integer,
  conservative_roi_bps integer,
  status text not null default 'sent' check (status in ('draft', 'sent', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now()
);

create table counteroffers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  negotiation_id uuid not null references negotiations(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  decision text not null check (decision in ('accept', 'counter', 'walk_away')),
  suggested_counter_cents integer,
  conservative_net_cents integer,
  created_at timestamptz not null default now()
);

create table communication_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null unique references negotiation_messages(id) on delete cascade,
  approved_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inventory and selling
-- ---------------------------------------------------------------------------
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  sku text not null,
  name text not null,
  category text,
  acquisition_source text,
  purchase_date date not null,
  purchase_price_cents integer not null check (purchase_price_cents >= 0),
  cost_basis_cents integer not null check (cost_basis_cents >= 0),
  serial_number text,
  condition text,
  accessories text,
  storage_location text,
  testing_status text not null default 'untested' check (testing_status in ('untested', 'passed', 'failed', 'not_applicable')),
  repair_status text not null default 'none' check (repair_status in ('none', 'needed', 'in_progress', 'done')),
  estimated_resale_cents integer,
  status text not null default 'acquired' check (status in (
    'acquired', 'needs_inspection', 'needs_cleaning', 'needs_repair', 'ready_to_list', 'listed', 'sold',
    'fulfillment_pending', 'shipped', 'completed', 'returned', 'written_off')),
  sold_at timestamptz,
  actual_proceeds_cents integer,
  actual_fees_cents integer,
  actual_profit_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, sku)
);
create index inventory_items_status on inventory_items (owner_id, status);

create table inventory_costs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  kind text not null check (kind in ('purchase', 'purchase_tax', 'travel', 'inbound_shipping', 'repair', 'parts', 'testing', 'cleaning', 'other')),
  amount_cents integer not null check (amount_cents >= 0),
  capitalized boolean not null,
  note text,
  journal_entry_id uuid,
  incurred_at timestamptz not null default now()
);

create table inventory_images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  storage_path text not null,
  kind text not null default 'photo' check (kind in ('photo', 'receipt', 'serial', 'defect')),
  created_at timestamptz not null default now()
);

create table item_inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete cascade,
  checklist jsonb not null,
  passed boolean,
  notes text,
  inspected_at timestamptz not null default now(),
  check (opportunity_id is not null or inventory_item_id is not null)
);

create table sale_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  channel text not null,
  external_listing_id text,
  title text not null,
  price_cents integer not null check (price_cents > 0),
  min_offer_cents integer,
  status text not null default 'draft' check (status in ('draft', 'active', 'ended', 'sold')),
  data jsonb not null default '{}'::jsonb,
  listed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index sale_listings_external on sale_listings (owner_id, channel, external_listing_id) where external_listing_id is not null;

create table orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  external_order_id text not null,
  ordered_at timestamptz not null,
  status text not null default 'paid' check (status in ('paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'partially_refunded')),
  item_subtotal_cents integer not null check (item_subtotal_cents >= 0),
  shipping_charged_cents integer not null default 0,
  tax_collected_cents integer not null default 0,
  fees_cents integer not null default 0,
  payout_cents integer,
  raw jsonb,
  created_at timestamptz not null default now(),
  -- Prevents double-counting the same marketplace order.
  unique (owner_id, channel, external_order_id)
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  sale_listing_id uuid references sale_listings(id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  price_cents integer not null,
  unique (order_id, inventory_item_id)
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  carrier text,
  service text,
  tracking text,
  label_cost_cents integer not null default 0,
  supplies_cents integer not null default 0,
  estimated_label_cents integer,
  shipped_at timestamptz,
  delivered_at timestamptz
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  refund_cents integer not null check (refund_cents >= 0),
  fee_credit_cents integer not null default 0,
  return_shipping_cents integer not null default 0,
  restocked boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Finance (double-entry)
-- ---------------------------------------------------------------------------
create table financial_accounts (
  code text primary key,
  label text not null,
  type text not null check (type in ('asset', 'equity', 'revenue', 'contra_revenue', 'expense'))
);

insert into financial_accounts (code, label, type) values
  ('cash', 'Cash', 'asset'),
  ('inventory', 'Inventory (cost basis)', 'asset'),
  ('owner_equity', 'Owner contributions', 'equity'),
  ('owner_draws', 'Owner withdrawals', 'equity'),
  ('sales_revenue', 'Sales revenue', 'revenue'),
  ('shipping_income', 'Shipping charged to buyers', 'revenue'),
  ('refunds', 'Refunds and returns', 'contra_revenue'),
  ('cogs', 'Cost of goods sold', 'expense'),
  ('marketplace_fees', 'Marketplace fees', 'expense'),
  ('shipping_expense', 'Shipping and postage', 'expense'),
  ('supplies', 'Packing supplies', 'expense'),
  ('transportation', 'Transportation', 'expense'),
  ('repairs', 'Repairs and testing', 'expense'),
  ('software', 'Software and data', 'expense'),
  ('write_offs', 'Inventory write-offs', 'expense'),
  ('other_expense', 'Other expenses', 'expense');

create table financial_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  memo text not null default '',
  occurred_at timestamptz not null,
  -- Idempotency key for imported or event-driven entries (sale:<order>, refund:<id>, purchase:<item>).
  external_ref text,
  created_at timestamptz not null default now()
);
create unique index financial_entries_external_ref on financial_entries (owner_id, external_ref) where external_ref is not null;
create index financial_entries_time on financial_entries (owner_id, occurred_at);

create table financial_entry_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references financial_entries(id) on delete cascade,
  account_code text not null references financial_accounts(code),
  debit_cents integer not null default 0 check (debit_cents >= 0),
  credit_cents integer not null default 0 check (credit_cents >= 0),
  inventory_item_id uuid references inventory_items(id) on delete set null,
  check ((debit_cents = 0) <> (credit_cents = 0))
);
create index financial_entry_lines_entry on financial_entry_lines (entry_id);
create index financial_entry_lines_account on financial_entry_lines (owner_id, account_code);

-- Reject unbalanced journal entries at commit time.
create function check_entry_balanced() returns trigger language plpgsql as $$
declare
  diff bigint;
  target uuid := coalesce(new.entry_id, old.entry_id);
begin
  select coalesce(sum(debit_cents), 0) - coalesce(sum(credit_cents), 0) into diff
  from financial_entry_lines where entry_id = target;
  if diff <> 0 then
    raise exception 'Journal entry % is unbalanced by % cents', target, diff;
  end if;
  return null;
end;
$$;

create constraint trigger financial_entry_lines_balanced
  after insert or update or delete on financial_entry_lines
  deferrable initially deferred
  for each row execute function check_entry_balanced();

-- Ledger history is append-only: corrections are new reversing entries.
create function forbid_ledger_update() returns trigger language plpgsql as $$
begin
  raise exception 'Ledger lines are immutable; post a reversing entry instead';
end;
$$;
create trigger financial_entry_lines_immutable before update on financial_entry_lines
  for each row execute function forbid_ledger_update();

create table expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_code text not null references financial_accounts(code),
  amount_cents integer not null check (amount_cents > 0),
  vendor text,
  note text,
  incurred_at timestamptz not null default now(),
  journal_entry_id uuid references financial_entries(id) on delete set null
);

create table capital_contributions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  note text,
  contributed_at timestamptz not null default now(),
  journal_entry_id uuid references financial_entries(id) on delete set null
);

create table owner_withdrawals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  note text,
  withdrawn_at timestamptz not null default now(),
  journal_entry_id uuid references financial_entries(id) on delete set null
);

create table financial_period_summaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  data jsonb not null,
  computed_at timestamptz not null default now(),
  unique (owner_id, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- Alerts, AI, audit, jobs
-- ---------------------------------------------------------------------------
create table alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  kind text not null check (kind in (
    'strong_buy', 'worth_the_drive', 'hidden_gem', 'price_drop', 'seller_counteroffer', 'new_verified_comps',
    'deal_expiring', 'pickup_reminder', 'sold_item', 'shipment_needed', 'inventory_aging', 'profit_milestone', 'data_source_failure')),
  priority text not null check (priority in ('critical', 'high', 'normal', 'low')),
  title text not null,
  body text not null,
  link text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, dedupe_key)
);
create index alerts_unread on alerts (owner_id, read_at, created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  alert_id uuid not null references alerts(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'push', 'sms')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'suppressed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (alert_id, channel)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create table ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references source_listings(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  kind text not null check (kind in ('prefilter', 'identify', 'hidden_gem', 'screenshot_extract', 'negotiation', 'advisor', 'weekly_review', 'listing_draft')),
  model text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cached', 'skipped_budget')),
  prompt_version text not null,
  input_hash text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_microdollars integer not null default 0,
  output jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_analysis_runs_cache on ai_analysis_runs (owner_id, kind, input_hash) where status = 'succeeded';

create table ai_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ai_run_id uuid references ai_analysis_runs(id) on delete set null,
  candidate_id uuid references item_identity_candidates(id) on delete set null,
  kind text not null check (kind in ('correct', 'incorrect', 'corrected', 'false_positive_deal', 'missed_detail', 'pricing_error')),
  correction jsonb,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  actor text not null check (actor in ('user', 'system', 'ai', 'worker')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity on audit_logs (owner_id, entity_type, entity_id, created_at desc);

create table background_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index background_jobs_ready on background_jobs (status, run_after) where status in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- Row-level security: every owned table is restricted to its owner.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles', 'user_roles', 'application_settings', 'user_preferences', 'integration_connections',
    'integration_sync_jobs', 'integration_errors', 'data_source_status', 'api_usage', 'search_profiles',
    'search_executions', 'source_listings', 'listing_images', 'listing_price_history', 'listing_observations',
    'listing_deduplication_links', 'opportunities', 'opportunity_evaluations', 'opportunity_scenarios',
    'opportunity_risk_factors', 'opportunity_status_events', 'user_decisions', 'detected_objects',
    'item_identity_candidates', 'identity_evidence', 'identification_reviews', 'authenticity_checks',
    'comparable_groups', 'comparable_sales', 'comparable_evidence', 'market_valuations', 'liquidity_estimates',
    'valuation_revisions', 'pickup_locations', 'route_estimates', 'pickup_trips', 'pickup_trip_stops',
    'negotiations', 'negotiation_messages', 'offers', 'counteroffers', 'communication_approvals',
    'inventory_items', 'inventory_costs', 'inventory_images', 'item_inspections', 'sale_listings', 'orders',
    'order_items', 'shipments', 'returns', 'financial_entries', 'financial_entry_lines', 'expenses',
    'capital_contributions', 'owner_withdrawals', 'financial_period_summaries', 'alerts', 'notifications',
    'push_subscriptions', 'ai_analysis_runs', 'ai_feedback', 'audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_owner_all', t);
  end loop;
end;
$$;

-- Owners can see and enqueue their own jobs; only the worker (service role) updates them.
alter table background_jobs enable row level security;
create policy background_jobs_owner_read on background_jobs for select using (owner_id = auth.uid());
create policy background_jobs_owner_enqueue on background_jobs for insert with check (owner_id = auth.uid());

-- Reference tables are readable by any signed-in user and writable only by the service role.
alter table financial_accounts enable row level security;
create policy financial_accounts_read on financial_accounts for select using (auth.uid() is not null);
alter table integration_capabilities enable row level security;
create policy integration_capabilities_read on integration_capabilities for select using (auth.uid() is not null);
