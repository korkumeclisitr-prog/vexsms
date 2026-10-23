-- =============================================================================
-- VexSMS — Initial Database Schema
-- -----------------------------------------------------------------------------
-- Tasarım ilkeleri:
--   * Para birimi her zaman TAM SAYI "minor unit" (cent/kuruş) olarak tutulur
--     (bigint). Floating point yuvarlama hataları imkânsızdır.
--   * Bakiye yalnızca SECURITY DEFINER RPC'ler üzerinden değişir. Bu RPC'lerin
--     EXECUTE yetkisi yalnızca `service_role`'dedir; tarayıcıdan (anon /
--     authenticated) çağrılamazlar. Fiyat her zaman sunucuda hesaplanır.
--   * Race condition koruması: her finansal işlem kullanıcının `profiles`
--     satırını `SELECT ... FOR UPDATE` ile kilitler; aynı kullanıcıya ait
--     eşzamanlı istekler seri hâle gelir. Ek olarak `CHECK (balance_cents >= 0)`
--     kısıtı, olası bir mantık hatasında bile bakiyenin eksiye düşmesini
--     veritabanı seviyesinde engeller.
--   * `transactions` tablosu değiştirilemez (append-only) bir muhasebe defteridir.
--   * İadeler idempotent'tir: bir sipariş için en fazla bir "refund" kaydı
--     oluşabilir (partial unique index + refunded_at kontrolü).
-- =============================================================================


-- =============================================================================
-- 1. ENUM TİPLERİ
-- =============================================================================

create type public.app_role as enum ('user', 'admin');

-- RESERVING : Bakiye bloke edildi, 5sim satın alma isteği henüz onaylanmadı.
-- PENDING   : 5sim numarayı tahsis etti, SMS bekleniyor.
-- RECEIVED  : En az bir SMS alındı (ücretlendirilebilir, iade edilmez).
-- FINISHED  : Sipariş tamamlandı.
-- CANCELED  : İptal edildi (SMS yoksa iade edilir).
-- TIMEOUT   : Süre doldu (SMS yoksa iade edilir).
-- BANNED    : Numara banlandı / kullanılmış (SMS yoksa iade edilir).
-- FAILED    : 5sim satın alma başarısız oldu veya rezervasyon zaman aşımına uğradı.
create type public.order_status as enum (
  'RESERVING',
  'PENDING',
  'RECEIVED',
  'FINISHED',
  'CANCELED',
  'TIMEOUT',
  'BANNED',
  'FAILED'
);

create type public.transaction_type as enum (
  'deposit',     -- Bakiye yükleme (ödeme sağlayıcısı webhook'u)
  'purchase',    -- Numara satın alma (negatif tutar)
  'refund',      -- Sipariş iadesi (pozitif tutar)
  'adjustment'   -- Admin manuel düzeltmesi (+/-)
);


-- =============================================================================
-- 2. TABLOLAR
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,
  full_name      text check (full_name is null or char_length(full_name) <= 120),
  avatar_url     text check (avatar_url is null or char_length(avatar_url) <= 1024),
  balance_cents  bigint not null default 0,
  currency       char(3) not null default 'USD',
  role           public.app_role not null default 'user',
  is_banned      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint profiles_balance_non_negative check (balance_cents >= 0),
  constraint profiles_currency_format check (currency ~ '^[A-Z]{3}$')
);

comment on table public.profiles is
  'Kullanıcı profili ve bakiyesi. Bakiye yalnızca service_role RPC''leri ile değişir.';
comment on column public.profiles.balance_cents is
  'Bakiye, minor unit (cent) cinsinden. Asla negatif olamaz.';

-- -----------------------------------------------------------------------------
-- 2.2 orders
-- -----------------------------------------------------------------------------
-- NOT: orders/transactions -> profiles ilişkisi "on delete restrict"tir.
-- Finansal geçmişi olan bir kullanıcı silinemez; bunun yerine is_banned = true
-- yapılmalıdır (muhasebe bütünlüğü).
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete restrict,
  idempotency_key    uuid not null,
  provider           text not null default '5sim',
  provider_order_id  bigint,
  country            text not null,
  operator           text not null,
  product            text not null,
  phone              text,
  price_cents        bigint not null,
  status             public.order_status not null default 'RESERVING',
  sms_code           text,
  sms_text           text,
  sms_sender         text,
  sms_received_at    timestamptz,
  sms_messages       jsonb not null default '[]'::jsonb,
  failure_reason     text check (failure_reason is null or char_length(failure_reason) <= 500),
  expires_at         timestamptz,
  refunded_at        timestamptz,
  finished_at        timestamptz,
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint orders_price_positive        check (price_cents > 0),
  constraint orders_provider_format       check (provider ~ '^[a-z0-9_]{1,32}$'),
  constraint orders_country_format        check (country  ~ '^[a-z0-9_-]{1,64}$'),
  constraint orders_operator_format       check (operator ~ '^[a-z0-9_-]{1,64}$'),
  constraint orders_product_format        check (product  ~ '^[a-z0-9_-]{1,64}$'),
  constraint orders_phone_format          check (phone is null or phone ~ '^\+?[0-9]{6,20}$'),
  constraint orders_sms_messages_is_array check (jsonb_typeof(sms_messages) = 'array'),
  constraint orders_refund_only_terminal  check (
    refunded_at is null or status in ('CANCELED', 'TIMEOUT', 'BANNED', 'FAILED')
  ),
  constraint orders_provider_id_required  check (
    status in ('RESERVING', 'FAILED') or provider_order_id is not null
  ),
  constraint orders_user_idempotency_unique unique (user_id, idempotency_key),
  constraint orders_provider_order_unique   unique (provider, provider_order_id)
);

comment on table public.orders is
  'Sanal numara siparişleri. Kullanıcılar yalnızca kendi siparişlerini okuyabilir; yazma işlemleri yalnızca RPC ile.';

create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index orders_active_poll_idx  on public.orders (status, last_checked_at)
  where status in ('RESERVING', 'PENDING', 'RECEIVED');
create index orders_expires_idx      on public.orders (expires_at)
  where status in ('PENDING', 'RECEIVED');

-- -----------------------------------------------------------------------------
-- 2.3 order_provider_meta  (YALNIZCA sunucu/admin — kullanıcıya kapalı)
-- -----------------------------------------------------------------------------
-- Sağlayıcı maliyeti (kâr marjı) ve ham API yanıtları kullanıcılara ve Realtime
-- yayınına sızmasın diye ayrı tabloda tutulur.
create table public.order_provider_meta (
  order_id        uuid primary key references public.orders (id) on delete cascade,
  quoted_cost     numeric(14, 4) not null check (quoted_cost >= 0),
  actual_cost     numeric(14, 4) check (actual_cost is null or actual_cost >= 0),
  raw_purchase    jsonb,
  raw_last_check  jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2.4 transactions  (append-only ledger)
-- -----------------------------------------------------------------------------
create table public.transactions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete restrict,
  type                 public.transaction_type not null,
  amount_cents         bigint not null,
  balance_after_cents  bigint not null,
  order_id             uuid references public.orders (id) on delete restrict,
  reference            text check (reference is null or char_length(reference) <= 255),
  description          text check (description is null or char_length(description) <= 500),
  metadata             jsonb not null default '{}'::jsonb,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),

  constraint transactions_amount_non_zero   check (amount_cents <> 0),
  constraint transactions_balance_after_ok  check (balance_after_cents >= 0),
  constraint transactions_amount_sign check (
       (type = 'deposit'    and amount_cents > 0)
    or (type = 'purchase'   and amount_cents < 0)
    or (type = 'refund'     and amount_cents > 0)
    or (type = 'adjustment')
  ),
  constraint transactions_order_link check (
    (type in ('purchase', 'refund')) = (order_id is not null)
  ),
  constraint transactions_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.transactions is
  'Değiştirilemez bakiye defteri. UPDATE/DELETE trigger ile engellenir.';

create index transactions_user_created_idx on public.transactions (user_id, created_at desc);
create index transactions_order_idx        on public.transactions (order_id) where order_id is not null;

-- Ödeme sağlayıcısı referansı global olarak tekildir (webhook tekrarlarına karşı).
create unique index transactions_reference_unique
  on public.transactions (reference) where reference is not null;

-- Bir sipariş için en fazla 1 satın alma ve en fazla 1 iade kaydı.
create unique index transactions_one_purchase_per_order
  on public.transactions (order_id) where type = 'purchase';
create unique index transactions_one_refund_per_order
  on public.transactions (order_id) where type = 'refund';


-- =============================================================================
-- 3. YARDIMCI & TRIGGER FONKSİYONLARI
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 updated_at otomatik güncelleme
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger order_provider_meta_set_updated_at
  before update on public.order_provider_meta
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3.2 Yeni kullanıcı kaydında otomatik profil oluşturma
-- -----------------------------------------------------------------------------
-- GÜVENLİK: raw_user_meta_data kullanıcı kontrolündedir. Buradan ASLA role,
-- balance veya is_banned gibi alanlar okunmaz; yalnızca kozmetik alanlar alınır.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120),
    left(new.raw_user_meta_data ->> 'avatar_url', 1024)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3.3 auth.users e-posta değişikliğini profile senkronlama
-- -----------------------------------------------------------------------------
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
       set email = new.email
     where id = new.id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- 3.4 Hassas profil kolonlarını koruma (derinlemesine savunma)
-- -----------------------------------------------------------------------------
-- Kolon bazlı GRANT zaten yalnızca full_name/avatar_url güncellemesine izin
-- verir. Bu trigger, olası bir yanlış GRANT durumunda ikinci savunma hattıdır.
-- SECURITY DEFINER RPC'ler içinde current_user = fonksiyon sahibi (postgres)
-- olduğundan meşru bakiye güncellemeleri etkilenmez.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id            is distinct from old.id
       or new.email         is distinct from old.email
       or new.balance_cents is distinct from old.balance_cents
       or new.currency      is distinct from old.currency
       or new.role          is distinct from old.role
       or new.is_banned     is distinct from old.is_banned
       or new.created_at    is distinct from old.created_at
    then
      raise exception 'FORBIDDEN_COLUMN_UPDATE'
        using errcode = '42501',
              hint    = 'Bu kolonlar istemci tarafından değiştirilemez.';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- -----------------------------------------------------------------------------
-- 3.5 Ledger değiştirilemezliği
-- -----------------------------------------------------------------------------
create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LEDGER_IMMUTABLE'
    using errcode = '42501',
          hint    = 'transactions tablosu append-only''dir. Düzeltme için yeni bir adjustment kaydı oluşturun.';
end;
$$;

create trigger transactions_immutable
  before update or delete on public.transactions
  for each row execute function public.prevent_ledger_mutation();

-- -----------------------------------------------------------------------------
-- 3.6 Admin kontrolü (RLS politikalarında kullanılır)
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: profiles RLS politikasının kendi kendini çağırarak sonsuz
-- döngüye girmesini (infinite recursion) engeller.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'admin'
       and p.is_banned = false
  );
$$;


-- =============================================================================
-- 4. ROW LEVEL SECURITY & YETKİLER
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.orders              enable row level security;
alter table public.order_provider_meta enable row level security;
alter table public.transactions        enable row level security;

-- Supabase varsayılan olarak anon/authenticated'a tüm tablo yetkilerini verir.
-- Önce hepsini geri alıp yalnızca gerekenleri açıkça veriyoruz.
revoke all on public.profiles            from anon, authenticated;
revoke all on public.orders              from anon, authenticated;
revoke all on public.order_provider_meta from anon, authenticated;
revoke all on public.transactions        from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4.1 profiles
-- -----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
-- Kullanıcı yalnızca kozmetik kolonları güncelleyebilir. balance_cents, role,
-- is_banned vb. için UPDATE yetkisi YOKTUR.
grant update (full_name, avatar_url) on public.profiles to authenticated;

create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  to authenticated
  using ( id = (select auth.uid()) or (select public.is_admin()) );

create policy "profiles_update_own_cosmetic"
  on public.profiles
  for update
  to authenticated
  using      ( id = (select auth.uid()) and is_banned = false )
  with check ( id = (select auth.uid()) );

-- INSERT / DELETE politikası yok => istemciden profil oluşturma/silme imkânsız.

-- -----------------------------------------------------------------------------
-- 4.2 orders  (yalnızca okuma)
-- -----------------------------------------------------------------------------
grant select on public.orders to authenticated;

create policy "orders_select_own_or_admin"
  on public.orders
  for select
  to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

-- -----------------------------------------------------------------------------
-- 4.3 order_provider_meta  (yalnızca admin okuyabilir)
-- -----------------------------------------------------------------------------
grant select on public.order_provider_meta to authenticated;

create policy "order_provider_meta_select_admin"
  on public.order_provider_meta
  for select
  to authenticated
  using ( (select public.is_admin()) );

-- -----------------------------------------------------------------------------
-- 4.4 transactions  (yalnızca okuma)
-- -----------------------------------------------------------------------------
grant select on public.transactions to authenticated;

create policy "transactions_select_own_or_admin"
  on public.transactions
  for select
  to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );


-- =============================================================================
-- 5. FİNANSAL RPC FONKSİYONLARI  (YALNIZCA service_role)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 reserve_order
-- -----------------------------------------------------------------------------
-- Atomik olarak:
--   1) Kullanıcı satırını kilitler (FOR UPDATE) -> eşzamanlı istekler sıraya girer
--   2) Idempotency kontrolü (çift tıklama / ağ tekrarı)
--   3) Ban + aktif sipariş limiti + bakiye kontrolü
--   4) Bakiyeyi düşer, RESERVING durumunda sipariş ve 'purchase' ledger kaydı açar
-- 5sim isteği bu fonksiyon döndükten SONRA yapılır. 5sim başarısız olursa
-- refund_order(..., 'FAILED') çağrılır.
create or replace function public.reserve_order(
  p_user_id            uuid,
  p_idempotency_key    uuid,
  p_country            text,
  p_operator           text,
  p_product            text,
  p_price_cents        bigint,
  p_quoted_cost        numeric,
  p_max_active_orders  integer default 5
)
returns table (
  order_id       uuid,
  order_status   public.order_status,
  balance_cents  bigint,
  is_duplicate   boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile       public.profiles%rowtype;
  v_existing      public.orders%rowtype;
  v_active_count  integer;
  v_new_balance   bigint;
  v_order_id      uuid;
begin
  -- ---- Girdi doğrulama ------------------------------------------------------
  if p_user_id is null or p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  if p_quoted_cost is null or p_quoted_cost < 0 then
    raise exception 'INVALID_QUOTED_COST' using errcode = 'P0001';
  end if;

  if p_max_active_orders is null or p_max_active_orders < 1 or p_max_active_orders > 50 then
    raise exception 'INVALID_ACTIVE_ORDER_LIMIT' using errcode = 'P0001';
  end if;

  -- ---- Kullanıcı satırını kilitle (race condition koruması) -----------------
  select *
    into v_profile
    from public.profiles p
   where p.id = p_user_id
     for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_profile.is_banned then
    raise exception 'USER_BANNED' using errcode = 'P0001';
  end if;

  -- ---- Idempotency (kilit altında kontrol edildiği için yarışsız) -----------
  select *
    into v_existing
    from public.orders o
   where o.user_id = p_user_id
     and o.idempotency_key = p_idempotency_key;

  if found then
    return query
      select v_existing.id, v_existing.status, v_profile.balance_cents, true;
    return;
  end if;

  -- ---- Aktif sipariş limiti (kötüye kullanım koruması) ----------------------
  select count(*)
    into v_active_count
    from public.orders o
   where o.user_id = p_user_id
     and o.status in ('RESERVING', 'PENDING');

  if v_active_count >= p_max_active_orders then
    raise exception 'TOO_MANY_ACTIVE_ORDERS' using errcode = 'P0001';
  end if;

  -- ---- Bakiye kontrolü ve düşümü --------------------------------------------
  if v_profile.balance_cents < p_price_cents then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  update public.profiles p
     set balance_cents = p.balance_cents - p_price_cents
   where p.id = p_user_id
  returning p.balance_cents into v_new_balance;

  -- ---- Sipariş + gizli maliyet + ledger kaydı -------------------------------
  insert into public.orders (
    user_id, idempotency_key, country, operator, product, price_cents, status
  )
  values (
    p_user_id, p_idempotency_key, p_country, p_operator, p_product, p_price_cents, 'RESERVING'
  )
  returning id into v_order_id;

  insert into public.order_provider_meta (order_id, quoted_cost)
  values (v_order_id, p_quoted_cost);

  insert into public.transactions (
    user_id, type, amount_cents, balance_after_cents, order_id, description
  )
  values (
    p_user_id,
    'purchase',
    -p_price_cents,
    v_new_balance,
    v_order_id,
    left(format('Numara satın alma: %s / %s / %s', p_product, p_country, p_operator), 500)
  );

  return query
    select v_order_id, 'RESERVING'::public.order_status, v_new_balance, false;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.2 confirm_order
-- -----------------------------------------------------------------------------
-- 5sim satın alma başarılı olduktan sonra çağrılır. Yalnızca RESERVING
-- durumundaki siparişi PENDING'e taşır. Sipariş bu arada (ör. rezervasyon
-- zaman aşımı nedeniyle) iade edildiyse INVALID_ORDER_STATE fırlatır; bu
-- durumda sunucu 5sim siparişini iptal etmelidir.
create or replace function public.confirm_order(
  p_order_id           uuid,
  p_provider_order_id  bigint,
  p_phone              text,
  p_operator           text,
  p_actual_cost        numeric,
  p_expires_at         timestamptz,
  p_raw                jsonb default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_provider_order_id is null or p_provider_order_id <= 0 then
    raise exception 'INVALID_PROVIDER_ORDER_ID' using errcode = 'P0001';
  end if;

  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_order.status <> 'RESERVING' then
    raise exception 'INVALID_ORDER_STATE'
      using errcode = 'P0001',
            detail  = format('Beklenen: RESERVING, mevcut: %s', v_order.status);
  end if;

  update public.orders o
     set provider_order_id = p_provider_order_id,
         phone             = p_phone,
         operator          = coalesce(nullif(p_operator, ''), o.operator),
         expires_at        = p_expires_at,
         status            = 'PENDING',
         last_checked_at   = now()
   where o.id = p_order_id
  returning * into v_order;

  update public.order_provider_meta m
     set actual_cost  = p_actual_cost,
         raw_purchase = p_raw
   where m.order_id = p_order_id;

  return v_order;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.3 refund_order  (idempotent)
-- -----------------------------------------------------------------------------
-- Siparişi terminal bir duruma taşır ve bakiyeyi iade eder.
--   * Zaten iade edilmişse hiçbir şey yapmaz (refunded = false döner).
--   * SMS alınmış siparişler ASLA iade edilmez (ORDER_NOT_REFUNDABLE).
-- Kilit sırası: orders -> profiles (reserve_order yalnızca profiles kilitler,
-- mevcut order satırlarını kilitlemez => deadlock döngüsü oluşmaz).
create or replace function public.refund_order(
  p_order_id      uuid,
  p_final_status  public.order_status,
  p_reason        text default null
)
returns table (
  refunded             boolean,
  refund_amount_cents  bigint,
  balance_cents        bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order        public.orders%rowtype;
  v_new_balance  bigint;
begin
  if p_final_status is null
     or p_final_status not in ('CANCELED', 'TIMEOUT', 'BANNED', 'FAILED') then
    raise exception 'INVALID_FINAL_STATUS' using errcode = 'P0001';
  end if;

  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotency: daha önce iade edildiyse sessizce çık.
  if v_order.refunded_at is not null then
    return query
      select false,
             0::bigint,
             (select p.balance_cents from public.profiles p where p.id = v_order.user_id);
    return;
  end if;

  -- SMS teslim edilmiş sipariş ücretlidir; iade edilemez.
  if v_order.sms_received_at is not null
     or v_order.status in ('RECEIVED', 'FINISHED') then
    raise exception 'ORDER_NOT_REFUNDABLE' using errcode = 'P0001';
  end if;

  update public.profiles p
     set balance_cents = p.balance_cents + v_order.price_cents
   where p.id = v_order.user_id
  returning p.balance_cents into v_new_balance;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.orders o
     set status         = p_final_status,
         refunded_at    = now(),
         finished_at    = coalesce(o.finished_at, now()),
         failure_reason = coalesce(left(p_reason, 500), o.failure_reason)
   where o.id = p_order_id;

  insert into public.transactions (
    user_id, type, amount_cents, balance_after_cents, order_id, description
  )
  values (
    v_order.user_id,
    'refund',
    v_order.price_cents,
    v_new_balance,
    p_order_id,
    left(format('İade (%s)', p_final_status), 500)
  );

  return query
    select true, v_order.price_cents, v_new_balance;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.4 sync_order_from_provider
-- -----------------------------------------------------------------------------
-- 5sim /user/check yanıtını veritabanına uygular (polling veya webhook).
--   * SMS varsa: RECEIVED (veya sağlayıcı terminal ise FINISHED). İade YOK.
--   * SMS yoksa ve CANCELED/TIMEOUT/BANNED: otomatik iade (aynı transaction).
--   * SMS yoksa ve FINISHED (anomali): TIMEOUT olarak iade.
--   * PENDING: yalnızca last_checked_at güncellenir.
-- Zaten terminal olan siparişler değiştirilmez (idempotent).
create or replace function public.sync_order_from_provider(
  p_order_id      uuid,
  p_status        public.order_status,
  p_sms_messages  jsonb default '[]'::jsonb,
  p_sms_code      text  default null,
  p_sms_text      text  default null,
  p_sms_sender    text  default null,
  p_raw           jsonb default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order          public.orders%rowtype;
  v_now            timestamptz := now();
  v_has_sms_array  boolean;
  v_has_sms        boolean;
  v_target_status  public.order_status;
begin
  if p_status is null or p_status in ('RESERVING', 'FAILED') then
    raise exception 'INVALID_PROVIDER_STATUS' using errcode = 'P0001';
  end if;

  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Terminal siparişlere dokunma.
  if v_order.status in ('FINISHED', 'CANCELED', 'TIMEOUT', 'BANNED', 'FAILED') then
    return v_order;
  end if;

  if v_order.status = 'RESERVING' then
    raise exception 'INVALID_ORDER_STATE'
      using errcode = 'P0001',
            detail  = 'Sipariş henüz sağlayıcı tarafından onaylanmadı.';
  end if;

  if p_raw is not null then
    update public.order_provider_meta m
       set raw_last_check = p_raw
     where m.order_id = p_order_id;
  end if;

  v_has_sms_array := case
    when p_sms_messages is not null and jsonb_typeof(p_sms_messages) = 'array'
      then jsonb_array_length(p_sms_messages) > 0
    else false
  end;

  v_has_sms := v_has_sms_array
            or nullif(btrim(coalesce(p_sms_code, '')), '') is not null
            or v_order.sms_received_at is not null;

  -- ---- SMS alınmış: ücretlendirilebilir, iade yok ---------------------------
  if v_has_sms then
    v_target_status := case
      when p_status in ('FINISHED', 'CANCELED', 'TIMEOUT', 'BANNED') then 'FINISHED'::public.order_status
      else 'RECEIVED'::public.order_status
    end;

    update public.orders o
       set status          = v_target_status,
           sms_messages    = case when v_has_sms_array then p_sms_messages else o.sms_messages end,
           sms_code        = coalesce(nullif(btrim(coalesce(p_sms_code, '')), ''), o.sms_code),
           sms_text        = coalesce(left(p_sms_text, 2000), o.sms_text),
           sms_sender      = coalesce(left(p_sms_sender, 120), o.sms_sender),
           sms_received_at = coalesce(o.sms_received_at, v_now),
           finished_at     = case
                               when v_target_status = 'FINISHED' then coalesce(o.finished_at, v_now)
                               else o.finished_at
                             end,
           last_checked_at = v_now
     where o.id = p_order_id
    returning * into v_order;

    return v_order;
  end if;

  -- ---- SMS yok + sağlayıcı terminal: otomatik iade --------------------------
  if p_status in ('CANCELED', 'TIMEOUT', 'BANNED') then
    perform public.refund_order(p_order_id, p_status, format('Sağlayıcı durumu: %s', p_status));
  elsif p_status = 'FINISHED' then
    perform public.refund_order(p_order_id, 'TIMEOUT', 'Sağlayıcı siparişi SMS olmadan kapattı');
  end if;

  update public.orders o
     set last_checked_at = v_now
   where o.id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.5 adjust_balance  (bakiye yükleme / admin düzeltmesi)
-- -----------------------------------------------------------------------------
-- Ödeme sağlayıcısı webhook'u (deposit) veya admin paneli (adjustment) için.
-- p_reference ile idempotent'tir: aynı ödeme referansı iki kez işlenemez.
create or replace function public.adjust_balance(
  p_user_id       uuid,
  p_amount_cents  bigint,
  p_type          public.transaction_type,
  p_reference     text  default null,
  p_description   text  default null,
  p_metadata      jsonb default '{}'::jsonb,
  p_created_by    uuid  default null
)
returns table (
  transaction_id  uuid,
  balance_cents   bigint,
  is_duplicate    boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_existing_tx   public.transactions%rowtype;
  v_new_balance   bigint;
  v_tx_id         uuid;
begin
  if p_type is null or p_type not in ('deposit', 'adjustment') then
    raise exception 'INVALID_TRANSACTION_TYPE' using errcode = 'P0001';
  end if;

  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  if p_type = 'deposit' and p_amount_cents < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  if p_type = 'deposit' and (p_reference is null or btrim(p_reference) = '') then
    raise exception 'REFERENCE_REQUIRED' using errcode = 'P0001';
  end if;

  -- Kullanıcıyı kilitle.
  perform 1
     from public.profiles p
    where p.id = p_user_id
      for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Referans tekrarı (webhook retry) => mevcut kaydı döndür.
  if p_reference is not null then
    select *
      into v_existing_tx
      from public.transactions t
     where t.reference = p_reference;

    if found then
      if v_existing_tx.user_id <> p_user_id then
        raise exception 'REFERENCE_CONFLICT' using errcode = 'P0001';
      end if;

      return query
        select v_existing_tx.id,
               (select p.balance_cents from public.profiles p where p.id = p_user_id),
               true;
      return;
    end if;
  end if;

  update public.profiles p
     set balance_cents = p.balance_cents + p_amount_cents
   where p.id = p_user_id
     and p.balance_cents + p_amount_cents >= 0
  returning p.balance_cents into v_new_balance;

  if not found then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  insert into public.transactions (
    user_id, type, amount_cents, balance_after_cents,
    reference, description, metadata, created_by
  )
  values (
    p_user_id,
    p_type,
    p_amount_cents,
    v_new_balance,
    p_reference,
    left(p_description, 500),
    coalesce(p_metadata, '{}'::jsonb),
    p_created_by
  )
  returning id into v_tx_id;

  return query
    select v_tx_id, v_new_balance, false;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.6 expire_stale_reservations  (çökme kurtarma)
-- -----------------------------------------------------------------------------
-- Sunucu, reserve_order ile confirm_order/refund_order arasında çökerse sipariş
-- RESERVING'de kalır ve bakiye bloke olur. Bu fonksiyon (cron ile) eşiği aşan
-- rezervasyonları iade eder. Eşik, 5sim HTTP timeout süresinden ÇOK daha uzun
-- olmalıdır (varsayılan 5 dk).
create or replace function public.expire_stale_reservations(
  p_older_than interval default interval '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_count  integer := 0;
begin
  if p_older_than is null or p_older_than < interval '1 minute' then
    raise exception 'INVALID_INTERVAL' using errcode = 'P0001';
  end if;

  for r in
    select o.id
      from public.orders o
     where o.status = 'RESERVING'
       and o.created_at < now() - p_older_than
     order by o.created_at
       for update skip locked
  loop
    perform public.refund_order(
      r.id,
      'FAILED',
      'Rezervasyon zaman aşımı: sağlayıcı satın alması onaylanmadı'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- =============================================================================
-- 6. FONKSİYON YETKİLERİ
-- =============================================================================
-- PostgreSQL varsayılan olarak fonksiyonlara PUBLIC EXECUTE verir; Supabase ek
-- olarak anon/authenticated'a da verir. Hepsini kapatıp yalnızca service_role'e
-- açıyoruz. Böylece istemci /rest/v1/rpc/* üzerinden bu fonksiyonları ÇAĞIRAMAZ.

revoke all on function public.reserve_order(uuid, uuid, text, text, text, bigint, numeric, integer)
  from public, anon, authenticated;
revoke all on function public.confirm_order(uuid, bigint, text, text, numeric, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.refund_order(uuid, public.order_status, text)
  from public, anon, authenticated;
revoke all on function public.sync_order_from_provider(uuid, public.order_status, jsonb, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.adjust_balance(uuid, bigint, public.transaction_type, text, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.expire_stale_reservations(interval)
  from public, anon, authenticated;

grant execute on function public.reserve_order(uuid, uuid, text, text, text, bigint, numeric, integer)
  to service_role;
grant execute on function public.confirm_order(uuid, bigint, text, text, numeric, timestamptz, jsonb)
  to service_role;
grant execute on function public.refund_order(uuid, public.order_status, text)
  to service_role;
grant execute on function public.sync_order_from_provider(uuid, public.order_status, jsonb, text, text, text, jsonb)
  to service_role;
grant execute on function public.adjust_balance(uuid, bigint, public.transaction_type, text, text, jsonb, uuid)
  to service_role;
grant execute on function public.expire_stale_reservations(interval)
  to service_role;

-- Trigger fonksiyonları doğrudan çağrılamaz.
revoke all on function public.set_updated_at()           from public, anon, authenticated;
revoke all on function public.handle_new_user()          from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;
revoke all on function public.protect_profile_columns()  from public, anon, authenticated;
revoke all on function public.prevent_ledger_mutation()  from public, anon, authenticated;

-- is_admin() RLS politikalarında kullanıldığı için authenticated'a açık olmalı.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;


-- =============================================================================
-- 7. REALTIME
-- =============================================================================
-- orders: SMS kodu geldiğinde UI anında güncellenir.
-- profiles: bakiye değişimi (satın alma / iade) anında yansır.
-- Realtime postgres_changes RLS'e uyar; kullanıcı yalnızca kendi satırlarını alır.
-- order_provider_meta ve transactions BİLİNÇLİ OLARAK yayına eklenmez.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      alter publication supabase_realtime add table public.orders;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;
  end if;
end;
$$;


-- =============================================================================
-- 8. (OPSİYONEL) pg_cron ile çökme kurtarma zamanlaması
-- =============================================================================
-- Supabase Dashboard > Database > Extensions üzerinden pg_cron'u etkinleştirdikten
-- sonra aşağıdaki satırı çalıştırın:
--
--   select cron.schedule(
--     'vexsms-expire-stale-reservations',
--     '* * * * *',
--     $cron$ select public.expire_stale_reservations(interval '5 minutes'); $cron$
--   );
