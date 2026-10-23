/**
 * VexSMS — 5sim API Servis Katmanı
 * ----------------------------------------------------------------------------
 * YALNIZCA SUNUCU TARAFINDA çalışır. `server-only` importu, bu modül yanlışlıkla
 * bir Client Component'e import edilirse build'i kırar; böylece FIVESIM_API_KEY
 * asla tarayıcı bundle'ına giremez.
 *
 * Özellikler:
 *  - Zod ile çalışma zamanı yanıt doğrulaması (tip güvenliği + savunmacı parse)
 *  - 5sim'in düz metin hata mesajlarını tipli `FiveSimError` kodlarına eşleme
 *  - Timeout (AbortSignal), exponential backoff + jitter, Retry-After desteği
 *  - İdempotent OLMAYAN `buyNumber` için retry KESİNLİKLE kapalı
 *  - Path injection'a karşı slug / order id doğrulaması
 *  - Guest (herkese açık) endpoint'lerde Next.js fetch cache; yetkili
 *    endpoint'lerde `no-store`
 *
 * 5sim API referansı: https://5sim.net/docs
 */

import "server-only";
import { z } from "zod";

/* ============================================================================
 * Sabitler
 * ========================================================================== */

const DEFAULT_BASE_URL = "https://5sim.net/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_PRICE_REVALIDATE_SECONDS = 60;
const COUNTRIES_REVALIDATE_SECONDS = 3_600;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 4_000;
const MAX_RETRY_AFTER_MS = 5_000;
const MAX_PROVIDER_MESSAGE_LENGTH = 300;
const DEFAULT_USER_AGENT = "VexSMS/1.0 (+https://vexsms.com)";

/** 5sim ülke / operatör / ürün slug formatı. Path injection'ı engeller. */
const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

/* ============================================================================
 * Sipariş durumları
 * ========================================================================== */

export const FIVESIM_ORDER_STATUSES = [
  "PENDING",
  "RECEIVED",
  "CANCELED",
  "TIMEOUT",
  "FINISHED",
  "BANNED",
] as const;

export type FiveSimOrderStatus = (typeof FIVESIM_ORDER_STATUSES)[number];

export const FIVESIM_TERMINAL_STATUSES: ReadonlySet<FiveSimOrderStatus> = new Set<FiveSimOrderStatus>([
  "FINISHED",
  "CANCELED",
  "TIMEOUT",
  "BANNED",
]);

/** SMS gelmemişse kullanıcıya iade gerektiren sağlayıcı durumları. */
export const FIVESIM_REFUNDABLE_STATUSES: ReadonlySet<FiveSimOrderStatus> = new Set<FiveSimOrderStatus>([
  "CANCELED",
  "TIMEOUT",
  "BANNED",
]);

/* ============================================================================
 * Hata yönetimi
 * ========================================================================== */

export const FIVESIM_ERROR_CODES = [
  "CONFIGURATION_ERROR",
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "NO_FREE_PHONES",
  "PROVIDER_BALANCE_LOW",
  "PROVIDER_RATING_LOW",
  "INVALID_COUNTRY",
  "INVALID_OPERATOR",
  "INVALID_PRODUCT",
  "PROVIDER_OFFLINE",
  "ORDER_NOT_FOUND",
  "ORDER_EXPIRED",
  "ORDER_HAS_SMS",
  "HOSTING_ORDER",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "INVALID_RESPONSE",
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNKNOWN",
] as const;

export type FiveSimErrorCode = (typeof FIVESIM_ERROR_CODES)[number];

/**
 * Son kullanıcıya gösterilebilecek güvenli mesajlar.
 * Sağlayıcı iç detayları (ör. "not enough user balance") ASLA kullanıcıya
 * gösterilmez; bu, platformun tedarikçi bakiyesi gibi iç bilgileri sızdırır.
 */
const USER_MESSAGES: Readonly<Record<FiveSimErrorCode, string>> = {
  CONFIGURATION_ERROR: "Servis şu anda yapılandırılıyor. Lütfen daha sonra tekrar deneyin.",
  INVALID_INPUT: "Geçersiz istek parametreleri.",
  UNAUTHORIZED: "Servis geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.",
  NO_FREE_PHONES: "Seçilen ülke/servis için şu anda müsait numara yok. Farklı bir operatör veya ülke deneyin.",
  PROVIDER_BALANCE_LOW: "Servis geçici olarak kullanılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.",
  PROVIDER_RATING_LOW: "Servis geçici olarak kullanılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.",
  INVALID_COUNTRY: "Seçilen ülke geçersiz veya desteklenmiyor.",
  INVALID_OPERATOR: "Seçilen operatör geçersiz veya desteklenmiyor.",
  INVALID_PRODUCT: "Seçilen servis bu ülke/operatör için desteklenmiyor.",
  PROVIDER_OFFLINE: "Numara sağlayıcısı şu anda yanıt vermiyor. Lütfen tekrar deneyin.",
  ORDER_NOT_FOUND: "Sipariş bulunamadı.",
  ORDER_EXPIRED: "Siparişin süresi dolmuş.",
  ORDER_HAS_SMS: "Bu siparişe SMS ulaştığı için iptal edilemez.",
  HOSTING_ORDER: "Bu sipariş türü için bu işlem desteklenmiyor.",
  RATE_LIMITED: "Çok fazla istek gönderildi. Lütfen birkaç saniye bekleyin.",
  TIMEOUT: "Sağlayıcı zamanında yanıt vermedi. Lütfen tekrar deneyin.",
  NETWORK_ERROR: "Sağlayıcıya bağlanılamadı. Lütfen tekrar deneyin.",
  UPSTREAM_ERROR: "Sağlayıcı tarafında geçici bir hata oluştu. Lütfen tekrar deneyin.",
  INVALID_RESPONSE: "Sağlayıcıdan beklenmeyen bir yanıt alındı.",
  BAD_REQUEST: "İstek sağlayıcı tarafından reddedildi.",
  NOT_FOUND: "İstenen kaynak bulunamadı.",
  UNKNOWN: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",
};

const RETRYABLE_CODES: ReadonlySet<FiveSimErrorCode> = new Set<FiveSimErrorCode>([
  "PROVIDER_OFFLINE",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
]);

/** 5sim düz metin hata gövdeleri -> tipli hata kodu. Sıra önemlidir. */
const PROVIDER_MESSAGE_RULES: ReadonlyArray<readonly [RegExp, FiveSimErrorCode]> = [
  [/no free phones/i, "NO_FREE_PHONES"],
  [/not enough user balance/i, "PROVIDER_BALANCE_LOW"],
  [/not enough rating/i, "PROVIDER_RATING_LOW"],
  [/(select|bad) country/i, "INVALID_COUNTRY"],
  [/(select|bad) operator/i, "INVALID_OPERATOR"],
  [/no product|(select|bad) (product|service)/i, "INVALID_PRODUCT"],
  [/server offline/i, "PROVIDER_OFFLINE"],
  [/order expired/i, "ORDER_EXPIRED"],
  [/order has sms/i, "ORDER_HAS_SMS"],
  [/hosting order/i, "HOSTING_ORDER"],
  [/(order|record) not found/i, "ORDER_NOT_FOUND"],
  [/too many requests|rate limit/i, "RATE_LIMITED"],
];

interface FiveSimErrorInit {
  code: FiveSimErrorCode;
  message?: string;
  httpStatus?: number | null;
  providerMessage?: string | null;
  endpoint?: string | null;
  retryAfterMs?: number | null;
  details?: unknown;
  cause?: unknown;
}

export class FiveSimError extends Error {
  readonly code: FiveSimErrorCode;
  readonly httpStatus: number | null;
  readonly providerMessage: string | null;
  readonly endpoint: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly details: unknown;

  constructor(init: FiveSimErrorInit) {
    const defaultMessage = `[5sim] ${init.code}${init.providerMessage ? `: ${init.providerMessage}` : ""}${
      init.endpoint ? ` (${init.endpoint})` : ""
    }`;

    super(init.message ?? defaultMessage, init.cause !== undefined ? { cause: init.cause } : undefined);

    this.name = "FiveSimError";
    this.code = init.code;
    this.httpStatus = init.httpStatus ?? null;
    this.providerMessage = init.providerMessage ?? null;
    this.endpoint = init.endpoint ?? null;
    this.retryable = RETRYABLE_CODES.has(init.code);
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.details = init.details;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Son kullanıcıya gösterilmesi güvenli mesaj. */
  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }

  /** Loglama için güvenli serileştirme (header / API key içermez). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      providerMessage: this.providerMessage,
      endpoint: this.endpoint,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      details: this.details,
    };
  }
}

export function isFiveSimError(error: unknown): error is FiveSimError {
  return error instanceof FiveSimError;
}

/**
 * `buyNumber` için sonucu BELİRSİZ hatalar: istek 5sim'e ulaşmış ve sipariş
 * oluşmuş olabilir. Bu durumda kullanıcıya iade yapmak güvenlidir; çünkü 5sim
 * yalnızca SMS teslim edilen siparişleri ücretlendirir ve SMS gelmeyen sahipsiz
 * sipariş süre dolunca 5sim tarafında otomatik iade edilir.
 */
export function isAmbiguousPurchaseFailure(error: unknown): boolean {
  return (
    isFiveSimError(error) &&
    (error.code === "TIMEOUT" ||
      error.code === "NETWORK_ERROR" ||
      error.code === "UPSTREAM_ERROR" ||
      error.code === "INVALID_RESPONSE")
  );
}

function mapProviderMessage(message: string): FiveSimErrorCode | null {
  for (const [pattern, code] of PROVIDER_MESSAGE_RULES) {
    if (pattern.test(message)) return code;
  }
  return null;
}

function codeFromHttpStatus(status: number): FiveSimErrorCode {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503 || status === 504) return "PROVIDER_OFFLINE";
  if (status >= 500) return "UPSTREAM_ERROR";
  if (status >= 400) return "BAD_REQUEST";
  return "UNKNOWN";
}

function sanitizeProviderMessage(raw: string, httpStatus: number): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Cloudflare / proxy HTML hata sayfalarını loglara basmayalım.
  if (trimmed.startsWith("<")) return `HTML response (HTTP ${httpStatus})`;
  const singleLine = trimmed.replace(/\s+/g, " ");
  return singleLine.length > MAX_PROVIDER_MESSAGE_LENGTH
    ? `${singleLine.slice(0, MAX_PROVIDER_MESSAGE_LENGTH)}…`
    : singleLine;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

/* ============================================================================
 * Zod şemaları & tipler
 * ========================================================================== */

const smsSchema = z.object({
  id: z.number().optional(),
  created_at: z.string().optional(),
  date: z.string().optional(),
  sender: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  text: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  code: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((value) => (value === null || value === undefined ? "" : String(value))),
  is_wave: z.boolean().optional(),
  wave_uuid: z.string().optional(),
});

export type FiveSimSms = z.output<typeof smsSchema>;

const orderSchema = z.object({
  id: z.number().int().positive(),
  phone: z.string().min(1),
  operator: z.string(),
  product: z.string(),
  price: z.number().nonnegative(),
  status: z.enum(FIVESIM_ORDER_STATUSES),
  expires: z.string(),
  sms: z
    .array(smsSchema)
    .nullish()
    .transform((value) => value ?? []),
  created_at: z.string(),
  forwarding: z.boolean().default(false),
  forwarding_number: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  country: z.string(),
});

export type FiveSimOrder = z.output<typeof orderSchema>;

const operatorPriceSchema = z.object({
  cost: z.coerce.number().nonnegative(),
  count: z.coerce.number().int().nonnegative(),
  rate: z.coerce.number().optional(),
});

/** /guest/prices yanıtı 3 seviyeli iç içe bir nesnedir; yaprakları tek tek doğrularız. */
const pricesRawSchema = z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())));

/** /guest/countries yanıtı: { [slug]: { iso, prefix, text_en, text_ru, [operator]: { activation: 1 } } } */
const countriesRawSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

const profileSchema = z.object({
  id: z.number(),
  email: z.string(),
  balance: z.number(),
  rating: z.number(),
  frozen_balance: z.number().optional(),
});

export type FiveSimProfile = z.output<typeof profileSchema>;

export interface FiveSimPriceEntry {
  country: string;
  product: string;
  operator: string;
  /** Sağlayıcı para biriminde maliyet (platform fiyatı DEĞİLDİR). */
  cost: number;
  /** Müsait numara adedi. */
  count: number;
  /** Teslim oranı (%), sağlayıcı döndürürse. */
  rate: number | null;
}

export interface FiveSimCountry {
  slug: string;
  name: string;
  iso: string[];
  prefixes: string[];
  operators: string[];
}

export interface GetPricesFilter {
  country?: string;
  product?: string;
}

export interface GetQuoteParams {
  country: string;
  product: string;
  /** Belirtilmez veya "any" ise stokta olan en ucuz operatör seçilir. */
  operator?: string;
}

export interface BuyNumberParams {
  country: string;
  operator: string;
  product: string;
  /** Maksimum maliyet (sağlayıcı para birimi). 5sim yalnızca operator = "any" iken dikkate alır. */
  maxPrice?: number;
  reuse?: boolean;
  voice?: boolean;
  ref?: string;
}

/** `sync_order_from_provider` RPC'sine gönderilecek normalize veri. */
export interface FiveSimSyncPayload {
  status: FiveSimOrderStatus;
  smsMessages: FiveSimSms[];
  smsCode: string | null;
  smsText: string | null;
  smsSender: string | null;
}

export interface FiveSimClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  priceRevalidateSeconds?: number;
  userAgent?: string;
}

/* ============================================================================
 * Girdi doğrulama yardımcıları
 * ========================================================================== */

function assertSlug(field: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new FiveSimError({ code: "INVALID_INPUT", message: `[5sim] "${field}" metin olmalıdır.` });
  }
  const normalized = value.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized)) {
    throw new FiveSimError({ code: "INVALID_INPUT", message: `[5sim] "${field}" geçersiz formatta.` });
  }
  return normalized;
}

function assertOrderId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FiveSimError({ code: "INVALID_INPUT", message: "[5sim] Geçersiz sipariş ID." });
  }
  return value;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================================================================
 * Saf yardımcı fonksiyonlar (sipariş / SMS)
 * ========================================================================== */

/**
 * 5sim tarihleri nanosaniye hassasiyetinde gelebilir
 * (ör. "2018-10-13T08:28:38.809469028Z"). Milisaniyeye kırpıp güvenle parse eder.
 */
export function parseFiveSimDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isTerminalStatus(status: FiveSimOrderStatus): boolean {
  return FIVESIM_TERMINAL_STATUSES.has(status);
}

export function hasSms(order: FiveSimOrder): boolean {
  return order.sms.length > 0;
}

/** SMS gelmeden iptal / zaman aşımı / ban => kullanıcıya iade gerekir. */
export function isRefundableOutcome(order: FiveSimOrder): boolean {
  return !hasSms(order) && FIVESIM_REFUNDABLE_STATUSES.has(order.status);
}

/** En son gelen SMS'i döndürür. */
export function getLatestSms(order: FiveSimOrder): FiveSimSms | null {
  if (order.sms.length === 0) return null;

  const timestamp = (sms: FiveSimSms): number =>
    parseFiveSimDate(sms.date ?? sms.created_at)?.getTime() ?? 0;

  return [...order.sms].sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null;
}

/**
 * SMS'ten doğrulama kodunu çıkarır. Öncelik 5sim'in ayrıştırdığı `code`
 * alanıdır; yoksa metinden 4-8 haneli veya "123-456" formatlı kod aranır.
 */
export function extractVerificationCode(sms: FiveSimSms): string | null {
  const direct = sms.code.trim();
  if (direct) return direct.slice(0, 32);

  const match = sms.text.match(/(?:^|\D)(\d{3}[-\s]\d{3}|\d{4,8})(?!\d)/);
  return match?.[1] ? match[1].replace(/[-\s]/g, "") : null;
}

/** 5sim sipariş yanıtını veritabanı senkronizasyonu için normalize eder. */
export function buildSyncPayload(order: FiveSimOrder): FiveSimSyncPayload {
  const latest = getLatestSms(order);

  return {
    status: order.status,
    smsMessages: order.sms,
    smsCode: latest ? extractVerificationCode(latest) : null,
    smsText: latest?.text ? latest.text : null,
    smsSender: latest?.sender ? latest.sender : null,
  };
}

/* ============================================================================
 * Normalizasyon
 * ========================================================================== */

const COUNTRY_RESERVED_KEYS = new Set(["iso", "prefix", "text_en", "text_ru"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCountry(slug: string, data: Record<string, unknown>): FiveSimCountry | null {
  if (!SLUG_PATTERN.test(slug)) return null;

  const iso = isPlainObject(data.iso) ? Object.keys(data.iso) : [];
  const prefixes = isPlainObject(data.prefix) ? Object.keys(data.prefix) : [];
  const name = typeof data.text_en === "string" && data.text_en.trim() ? data.text_en.trim() : slug;

  const operators = Object.entries(data)
    .filter(
      ([key, value]) =>
        !COUNTRY_RESERVED_KEYS.has(key) && SLUG_PATTERN.test(key) && isPlainObject(value) && "activation" in value,
    )
    .map(([key]) => key)
    .sort();

  return { slug, name, iso, prefixes, operators };
}

/* ============================================================================
 * İstemci
 * ========================================================================== */

type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  /** true => Authorization header eklenir ve yanıt ASLA cache'lenmez. */
  authenticated: boolean;
  retries: number;
  query?: Record<string, QueryValue>;
  /** Yalnızca guest endpoint'ler için Next.js fetch cache süresi. */
  revalidateSeconds?: number;
}

export class FiveSimClient {
  /** ES private field: console.log / JSON.stringify ile sızmaz. */
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly priceRevalidateSeconds: number;
  private readonly userAgent: string;

  constructor(config: FiveSimClientConfig) {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new FiveSimError({ code: "CONFIGURATION_ERROR", message: "[5sim] API anahtarı boş olamaz." });
    }

    const baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!/^https:\/\//i.test(baseUrl)) {
      throw new FiveSimError({ code: "CONFIGURATION_ERROR", message: "[5sim] Base URL HTTPS olmalıdır." });
    }

    this.#apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, Math.min(config.maxRetries ?? DEFAULT_MAX_RETRIES, 5));
    this.priceRevalidateSeconds = config.priceRevalidateSeconds ?? DEFAULT_PRICE_REVALIDATE_SECONDS;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
  }

  /* ------------------------------------------------------------------------
   * Guest (herkese açık) endpoint'ler
   * ---------------------------------------------------------------------- */

  /** Desteklenen ülkeler ve operatörleri. 1 saat cache'lenir. */
  async getCountries(): Promise<FiveSimCountry[]> {
    const raw = await this.request("/guest/countries", countriesRawSchema, {
      authenticated: false,
      retries: this.maxRetries,
      revalidateSeconds: COUNTRIES_REVALIDATE_SECONDS,
    });

    return Object.entries(raw)
      .map(([slug, data]) => normalizeCountry(slug, data))
      .filter((country): country is FiveSimCountry => country !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  /**
   * Fiyat listesi (normalize, düz liste).
   *
   * 5sim yanıt şekli filtreye göre değişir:
   *  - country (+/- product) veya filtresiz: { country: { product: { operator: price } } }
   *  - yalnızca product:                       { product: { country: { operator: price } } }
   *
   * Not: Filtresiz çağrı çok büyük (MB'lar) bir yanıt döndürür; üretimde her
   * zaman en az bir filtre kullanın.
   */
  async getPrices(filter: GetPricesFilter = {}): Promise<FiveSimPriceEntry[]> {
    const country = filter.country !== undefined ? assertSlug("country", filter.country) : undefined;
    const product = filter.product !== undefined ? assertSlug("product", filter.product) : undefined;

    const raw = await this.request("/guest/prices", pricesRawSchema, {
      authenticated: false,
      retries: this.maxRetries,
      query: { country, product },
      revalidateSeconds: this.priceRevalidateSeconds,
    });

    const productFirst = product !== undefined && country === undefined;
    const entries: FiveSimPriceEntry[] = [];

    for (const [outerKey, middle] of Object.entries(raw)) {
      for (const [middleKey, operators] of Object.entries(middle)) {
        for (const [operator, value] of Object.entries(operators)) {
          const parsed = operatorPriceSchema.safeParse(value);
          if (!parsed.success) continue;

          const entryCountry = productFirst ? middleKey : outerKey;
          const entryProduct = productFirst ? outerKey : middleKey;

          if (!SLUG_PATTERN.test(entryCountry) || !SLUG_PATTERN.test(entryProduct) || !SLUG_PATTERN.test(operator)) {
            continue;
          }

          entries.push({
            country: entryCountry,
            product: entryProduct,
            operator,
            cost: parsed.data.cost,
            count: parsed.data.count,
            rate: parsed.data.rate ?? null,
          });
        }
      }
    }

    return entries;
  }

  /**
   * Belirli bir ülke + servis için satın alınabilir fiyat teklifi.
   * Stokta (count > 0) olmayan operatörler elenir. Fiyat SUNUCUDA hesaplanmalıdır;
   * istemciden gelen fiyata asla güvenilmez.
   */
  async getQuote(params: GetQuoteParams): Promise<FiveSimPriceEntry | null> {
    const country = assertSlug("country", params.country);
    const product = assertSlug("product", params.product);
    const operator = params.operator !== undefined ? assertSlug("operator", params.operator) : "any";

    const entries = await this.getPrices({ country, product });
    const available = entries.filter(
      (entry) => entry.country === country && entry.product === product && entry.count > 0 && entry.cost > 0,
    );

    if (operator !== "any") {
      return available.find((entry) => entry.operator === operator) ?? null;
    }

    return available.sort((a, b) => a.cost - b.cost || b.count - a.count)[0] ?? null;
  }

  /* ------------------------------------------------------------------------
   * Yetkili (user) endpoint'ler
   * ---------------------------------------------------------------------- */

  /** Sağlayıcı hesap bilgisi (sağlık kontrolü / admin paneli için). */
  async getProfile(): Promise<FiveSimProfile> {
    return this.request("/user/profile", profileSchema, {
      authenticated: true,
      retries: this.maxRetries,
    });
  }

  /**
   * Aktivasyon numarası satın alır.
   *
   * ⚠️ İDEMPOTENT DEĞİLDİR — retry KAPALIDIR. Otomatik tekrar, çift satın almaya
   * yol açabilir. TIMEOUT / NETWORK_ERROR durumunda sonuç belirsizdir; bkz.
   * `isAmbiguousPurchaseFailure`.
   */
  async buyNumber(params: BuyNumberParams): Promise<FiveSimOrder> {
    const country = assertSlug("country", params.country);
    const operator = assertSlug("operator", params.operator);
    const product = assertSlug("product", params.product);

    if (params.maxPrice !== undefined && (!Number.isFinite(params.maxPrice) || params.maxPrice <= 0)) {
      throw new FiveSimError({ code: "INVALID_INPUT", message: "[5sim] maxPrice pozitif bir sayı olmalıdır." });
    }

    if (params.ref !== undefined && !/^[a-zA-Z0-9_-]{1,64}$/.test(params.ref)) {
      throw new FiveSimError({ code: "INVALID_INPUT", message: "[5sim] Geçersiz ref değeri." });
    }

    return this.request(`/user/buy/activation/${country}/${operator}/${product}`, orderSchema, {
      authenticated: true,
      retries: 0,
      query: {
        maxPrice: params.maxPrice,
        reuse: params.reuse ? 1 : undefined,
        voice: params.voice ? 1 : undefined,
        ref: params.ref,
      },
    });
  }

  /** Sipariş durumu ve gelen SMS'ler. İdempotent; retry açık. */
  async checkOrder(orderId: number): Promise<FiveSimOrder> {
    const id = assertOrderId(orderId);

    return this.request(`/user/check/${id}`, orderSchema, {
      authenticated: true,
      retries: this.maxRetries,
    });
  }

  /** SMS alındıktan sonra siparişi tamamlar. */
  async finishOrder(orderId: number): Promise<FiveSimOrder> {
    const id = assertOrderId(orderId);

    return this.request(`/user/finish/${id}`, orderSchema, {
      authenticated: true,
      retries: 0,
    });
  }

  /**
   * Siparişi iptal eder — sonuç bakımından idempotent davranır.
   *
   * İptal isteği belirsiz biçimde başarısız olursa (ağ hatası) veya sipariş
   * zaten kapanmışsa, gerçek durum `checkOrder` ile doğrulanır ve güncel sipariş
   * döndürülür. Çağıran taraf her zaman dönen `status` ve `sms` alanına göre
   * iade kararı vermelidir (bkz. `isRefundableOutcome`).
   *
   * SMS gelmiş siparişte `ORDER_HAS_SMS` fırlatılır (iade YAPILMAMALIDIR).
   */
  async cancelOrder(orderId: number): Promise<FiveSimOrder> {
    const id = assertOrderId(orderId);
    const path = `/user/cancel/${id}`;

    try {
      return await this.request(path, orderSchema, { authenticated: true, retries: 0 });
    } catch (error) {
      if (
        !isFiveSimError(error) ||
        error.code === "ORDER_HAS_SMS" ||
        error.code === "UNAUTHORIZED" ||
        error.code === "INVALID_INPUT" ||
        error.code === "CONFIGURATION_ERROR"
      ) {
        throw error;
      }

      const current = await this.checkOrder(id).catch(() => null);
      if (!current) throw error;

      if (current.status !== "PENDING") {
        return current;
      }

      if (error.retryable) {
        return this.request(path, orderSchema, { authenticated: true, retries: 0 });
      }

      throw error;
    }
  }

  /** Numara daha önce kullanılmış / çalışmıyorsa banlar (5sim tarafında iade edilir). */
  async banOrder(orderId: number): Promise<FiveSimOrder> {
    const id = assertOrderId(orderId);

    return this.request(`/user/ban/${id}`, orderSchema, {
      authenticated: true,
      retries: 0,
    });
  }

  /* ------------------------------------------------------------------------
   * HTTP çekirdeği
   * ---------------------------------------------------------------------- */

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    options: RequestOptions,
  ): Promise<z.output<S>> {
    const url = this.buildUrl(path, options.query);
    let lastError: FiveSimError | null = null;

    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
      try {
        return await this.executeOnce(url, path, schema, options);
      } catch (error) {
        const normalized = isFiveSimError(error)
          ? error
          : new FiveSimError({ code: "UNKNOWN", endpoint: path, cause: error });

        lastError = normalized;

        if (!normalized.retryable || attempt >= options.retries) {
          throw normalized;
        }

        await sleep(this.computeBackoff(attempt, normalized));
      }
    }

    throw lastError ?? new FiveSimError({ code: "UNKNOWN", endpoint: path });
  }

  private async executeOnce<S extends z.ZodType>(
    url: string,
    path: string,
    schema: S,
    options: RequestOptions,
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };

    if (options.authenticated) {
      headers.Authorization = `Bearer ${this.#apiKey}`;
    }

    const cacheable = !options.authenticated && options.revalidateSeconds !== undefined;

    const init: RequestInit = {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
      ...(cacheable ? { next: { revalidate: options.revalidateSeconds } } : { cache: "no-store" as const }),
    };

    let response: Response;
    let rawBody: string;

    try {
      response = await fetch(url, init);
      rawBody = await response.text();
    } catch (error) {
      throw this.toTransportError(error, path);
    }

    if (!response.ok) {
      throw this.toHttpError(response, rawBody, path);
    }

    const trimmed = rawBody.trim();
    if (!trimmed) {
      throw new FiveSimError({
        code: "INVALID_RESPONSE",
        httpStatus: response.status,
        endpoint: path,
        message: "[5sim] Boş yanıt gövdesi.",
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      // 5sim bazı hataları HTTP 200 + düz metin olarak döndürür (ör. "no free phones").
      throw this.toProviderTextError(trimmed, response.status, path);
    }

    if (typeof payload === "string") {
      throw this.toProviderTextError(payload, response.status, path);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new FiveSimError({
        code: "INVALID_RESPONSE",
        httpStatus: response.status,
        endpoint: path,
        message: "[5sim] Yanıt şeması doğrulanamadı.",
        details: parsed.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return parsed.data;
  }

  private toTransportError(error: unknown, path: string): FiveSimError {
    const name = error instanceof Error ? error.name : "";
    const isTimeout = name === "TimeoutError" || name === "AbortError";

    return new FiveSimError({
      code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
      endpoint: path,
      message: isTimeout
        ? `[5sim] İstek ${this.timeoutMs}ms içinde tamamlanamadı (${path}).`
        : `[5sim] Ağ hatası (${path}).`,
      cause: error,
    });
  }

  private toHttpError(response: Response, rawBody: string, path: string): FiveSimError {
    const providerMessage = sanitizeProviderMessage(rawBody, response.status);
    const mapped = providerMessage ? mapProviderMessage(providerMessage) : null;
    const code = mapped ?? codeFromHttpStatus(response.status);

    return new FiveSimError({
      code,
      httpStatus: response.status,
      providerMessage,
      endpoint: path,
      retryAfterMs: response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : null,
    });
  }

  private toProviderTextError(text: string, httpStatus: number, path: string): FiveSimError {
    const providerMessage = sanitizeProviderMessage(text, httpStatus);
    const mapped = providerMessage ? mapProviderMessage(providerMessage) : null;

    return new FiveSimError({
      code: mapped ?? "INVALID_RESPONSE",
      httpStatus,
      providerMessage,
      endpoint: path,
    });
  }

  private computeBackoff(attempt: number, error: FiveSimError): number {
    if (error.retryAfterMs !== null) {
      return error.retryAfterMs;
    }

    const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    const jitter = Math.random() * exponential * 0.3;
    return Math.round(exponential + jitter);
  }
}

/* ============================================================================
 * Singleton & modül seviyesinde kısayollar
 * ========================================================================== */

let singleton: FiveSimClient | null = null;

/**
 * Ortam değişkenlerinden yapılandırılmış tekil istemci.
 *
 * Gerekli:   FIVESIM_API_KEY
 * Opsiyonel: FIVESIM_BASE_URL, FIVESIM_TIMEOUT_MS, FIVESIM_MAX_RETRIES,
 *            FIVESIM_PRICE_REVALIDATE_SECONDS
 */
export function getFiveSimClient(): FiveSimClient {
  if (singleton) return singleton;

  // Yanlış yapılandırma koruması: NEXT_PUBLIC_ önekli değişkenler tarayıcı
  // bundle'ına gömülür. 5sim anahtarı asla bu önekle tanımlanmamalıdır.
  const leakedPublicKey = Object.keys(process.env).find(
    (key) => key.startsWith("NEXT_PUBLIC_") && key.toUpperCase().includes("FIVESIM"),
  );
  if (leakedPublicKey) {
    throw new FiveSimError({
      code: "CONFIGURATION_ERROR",
      message: `[5sim] GÜVENLİK: "${leakedPublicKey}" tanımlı. 5sim anahtarı NEXT_PUBLIC_ önekiyle tanımlanamaz.`,
    });
  }

  const apiKey = process.env.FIVESIM_API_KEY?.trim();
  if (!apiKey) {
    throw new FiveSimError({
      code: "CONFIGURATION_ERROR",
      message: "[5sim] FIVESIM_API_KEY ortam değişkeni tanımlı değil.",
    });
  }

  const maxRetriesRaw = process.env.FIVESIM_MAX_RETRIES;
  const maxRetries =
    maxRetriesRaw !== undefined && /^\d+$/.test(maxRetriesRaw) ? Number.parseInt(maxRetriesRaw, 10) : undefined;

  singleton = new FiveSimClient({
    apiKey,
    baseUrl: process.env.FIVESIM_BASE_URL,
    timeoutMs: parsePositiveInt(process.env.FIVESIM_TIMEOUT_MS),
    maxRetries,
    priceRevalidateSeconds: parsePositiveInt(process.env.FIVESIM_PRICE_REVALIDATE_SECONDS),
  });

  return singleton;
}

export function getCountries(): Promise<FiveSimCountry[]> {
  return getFiveSimClient().getCountries();
}

export function getPrices(filter?: GetPricesFilter): Promise<FiveSimPriceEntry[]> {
  return getFiveSimClient().getPrices(filter);
}

export function getQuote(params: GetQuoteParams): Promise<FiveSimPriceEntry | null> {
  return getFiveSimClient().getQuote(params);
}

export function buyNumber(params: BuyNumberParams): Promise<FiveSimOrder> {
  return getFiveSimClient().buyNumber(params);
}

export function checkOrder(orderId: number): Promise<FiveSimOrder> {
  return getFiveSimClient().checkOrder(orderId);
}

export function finishOrder(orderId: number): Promise<FiveSimOrder> {
  return getFiveSimClient().finishOrder(orderId);
}

export function cancelOrder(orderId: number): Promise<FiveSimOrder> {
  return getFiveSimClient().cancelOrder(orderId);
}

export function banOrder(orderId: number): Promise<FiveSimOrder> {
  return getFiveSimClient().banOrder(orderId);
}

export function getProviderProfile(): Promise<FiveSimProfile> {
  return getFiveSimClient().getProfile();
}
