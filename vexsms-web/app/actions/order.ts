"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  buyNumber,
  checkOrder,
  cancelOrder,
  getQuote,
  isFiveSimError,
  buildSyncPayload,
  parseFiveSimDate,
} from "@/lib/5sim";
import { calculateRetailPriceCents } from "@/lib/pricing";

const buyNumberInputSchema = z.object({
  country: z.string().min(1).max(64),
  operator: z.string().min(1).max(64),
  product: z.string().min(1).max(64),
  idempotencyKey: z.string().uuid().optional(),
});

export type BuyNumberResult =
  | {
      success: true;
      order: {
        id: string;
        providerOrderId: number;
        phone: string;
        product: string;
        country: string;
        operator: string;
        priceCents: number;
        status: string;
        expiresAt: string | null;
      };
      balanceCents: number;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };

/**
 * Numara satın alma Server Action'ı
 * ----------------------------------------------------------------------------
 * 1. Oturum ve bakiye kontrolü
 * 2. 5sim'den güncel fiyat ve stok doğrulama
 * 3. PostgreSQL RPC `reserve_order` ile atomik bakiye bloke & sipariş rezervasyonu
 * 4. 5sim API `buyNumber` çağrısı
 * 5. Başarılıysa `confirm_order` ile sipariş aktifleştirme (PENDING)
 * 6. Başarısız olursa `refund_order` ile anında otomatik bakiye iadesi
 */
export async function buyNumberAction(rawInput: unknown): Promise<BuyNumberResult> {
  const parsed = buyNumberInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: "Geçersiz sipariş parametreleri." };
  }

  const { country, operator, product } = parsed.data;
  const idempotencyKey = parsed.data.idempotencyKey || crypto.randomUUID();

  // 1. Oturum Kontrolü
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Lütfen önce giriş yapın.", code: "UNAUTHORIZED" };
  }

  // 2. 5sim Fiyat ve Stok Sorgusu
  let quote;
  try {
    quote = await getQuote({ country, product, operator });
  } catch (err) {
    const message = isFiveSimError(err) ? err.userMessage : "Sağlayıcı fiyat bilgisi alınamadı.";
    return { success: false, error: message };
  }

  if (!quote || quote.count <= 0) {
    return {
      success: false,
      error: "Seçtiğiniz ülke ve servis için şu anda müsait numara bulunmamaktadır.",
      code: "NO_FREE_PHONES",
    };
  }

  const targetOperator = quote.operator;
  const { quotedCost, retailPriceCents } = calculateRetailPriceCents(quote.cost);

  // 3. Atomik Bakiye Bloke & Sipariş Rezervasyonu (PostgreSQL RPC)
  const adminClient = getAdminClient();
  const { data: reserveRows, error: reserveError } = await adminClient.rpc("reserve_order", {
    p_user_id: user.id,
    p_idempotency_key: idempotencyKey,
    p_country: country,
    p_operator: targetOperator,
    p_product: product,
    p_price_cents: retailPriceCents,
    p_quoted_cost: quotedCost,
    p_max_active_orders: 5,
  });

  if (reserveError) {
    if (reserveError.message.includes("INSUFFICIENT_BALANCE")) {
      return { success: false, error: "Yetersiz bakiye. Lütfen bakiye yükleyin.", code: "INSUFFICIENT_BALANCE" };
    }
    if (reserveError.message.includes("TOO_MANY_ACTIVE_ORDERS")) {
      return {
        success: false,
        error: "Aynı anda en fazla 5 aktif siparişiniz olabilir. Lütfen mevcut siparişlerin tamamlanmasını bekleyin.",
        code: "TOO_MANY_ACTIVE_ORDERS",
      };
    }
    return { success: false, error: "Sipariş rezervasyonu oluşturulamadı: " + reserveError.message };
  }

  const reservation = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
  if (!reservation || !reservation.order_id) {
    return { success: false, error: "Rezervasyon yanıtı alınamadı." };
  }

  const dbOrderId = reservation.order_id;

  // 4. 5sim API Satın Alma Çağrısı
  let fiveSimOrder;
  try {
    fiveSimOrder = await buyNumber({
      country,
      operator: targetOperator,
      product,
    });
  } catch (buyErr) {
    // 5sim hatası durumunda: Kullanıcının bloke edilen bakiyesini anında iade et!
    const failureReason = isFiveSimError(buyErr) ? buyErr.userMessage : "5sim satın alma başarısız oldu.";
    await adminClient.rpc("refund_order", {
      p_order_id: dbOrderId,
      p_final_status: "FAILED",
      p_reason: failureReason,
    });

    return {
      success: false,
      error: failureReason,
      code: isFiveSimError(buyErr) ? buyErr.code : "BUY_FAILED",
    };
  }

  // 5. Sipariş Onaylama (confirm_order RPC)
  const parsedExpires = parseFiveSimDate(fiveSimOrder.expires);
  const expiresAt = parsedExpires ? parsedExpires.toISOString() : null;

  const { data: confirmedOrder, error: confirmError } = await adminClient.rpc("confirm_order", {
    p_order_id: dbOrderId,
    p_provider_order_id: fiveSimOrder.id,
    p_phone: fiveSimOrder.phone,
    p_operator: fiveSimOrder.operator || targetOperator,
    p_actual_cost: fiveSimOrder.price,
    p_expires_at: expiresAt,
    p_raw: fiveSimOrder,
  });

  if (confirmError) {
    // Çok nadir durum: Eğer onay RPC'si hata verdiyse 5sim siparişini iptal et ve iade sağla
    try {
      await cancelOrder(fiveSimOrder.id);
    } catch {
      // İptal loglanır
    }
    await adminClient.rpc("refund_order", {
      p_order_id: dbOrderId,
      p_final_status: "FAILED",
      p_reason: "Veritabanı onay hatası",
    });

    return { success: false, error: "Sipariş tamamlanırken bir hata oluştu ve bakiye iade edildi." };
  }

  return {
    success: true,
    order: {
      id: dbOrderId,
      providerOrderId: fiveSimOrder.id,
      phone: fiveSimOrder.phone,
      product,
      country,
      operator: fiveSimOrder.operator || targetOperator,
      priceCents: retailPriceCents,
      status: "PENDING",
      expiresAt,
    },
    balanceCents: reservation.balance_cents,
  };
}

/**
 * Sipariş Durumu ve SMS Kontrolü
 * ----------------------------------------------------------------------------
 * 5sim API'sini sorgular, yeni SMS veya durum değişikliği varsa veritabanına
 * atomik olarak senkronlar (`sync_order_from_provider` RPC).
 */
export async function checkOrderAction(orderId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Yetkisiz erişim." };
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: "Sipariş bulunamadı." };
  }

  // Sipariş zaten sonlandıysa tekrar dış API sorgusu yapmaya gerek yok
  if (["FINISHED", "CANCELED", "TIMEOUT", "BANNED", "FAILED"].includes(order.status)) {
    return { success: true, order };
  }

  if (!order.provider_order_id) {
    return { success: true, order };
  }

  // 5sim API Kontrolü
  const adminClient = getAdminClient();
  try {
    const providerOrder = await checkOrder(order.provider_order_id);
    const syncPayload = buildSyncPayload(providerOrder);

    const { data: updatedOrder, error: syncError } = await adminClient.rpc(
      "sync_order_from_provider",
      {
        p_order_id: order.id,
        p_status: syncPayload.status,
        p_sms_messages: syncPayload.smsMessages,
        p_sms_code: syncPayload.smsCode,
        p_sms_text: syncPayload.smsText,
        p_sms_sender: syncPayload.smsSender,
        p_raw: providerOrder,
      }
    );

    if (syncError) {
      return { success: false, error: "Senkronizasyon hatası: " + syncError.message };
    }

    return { success: true, order: updatedOrder };
  } catch (err) {
    const errorMsg = isFiveSimError(err) ? err.userMessage : "5sim durum kontrolü başarısız.";
    return { success: false, error: errorMsg, order };
  }
}

/**
 * Siparişi İptal Etme ve Bakiye İadesi
 * ----------------------------------------------------------------------------
 */
export async function cancelOrderAction(orderId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Yetkisiz erişim." };
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    return { success: false, error: "Sipariş bulunamadı." };
  }

  if (order.sms_code || order.status === "RECEIVED") {
    return { success: false, error: "SMS ulaşmış siparişler iptal edilemez." };
  }

  if (["CANCELED", "TIMEOUT", "FINISHED", "BANNED"].includes(order.status)) {
    return { success: true, message: "Sipariş zaten kapatılmış." };
  }

  const adminClient = getAdminClient();

  try {
    if (order.provider_order_id) {
      await cancelOrder(order.provider_order_id);
    }
  } catch (cancelErr) {
    if (isFiveSimError(cancelErr) && cancelErr.code === "ORDER_HAS_SMS") {
      // SMS gelmişse durumu güncelle ve hata dön
      await checkOrderAction(orderId);
      return { success: false, error: "Bu numaraya SMS kodu ulaştığı için iptal edilemez." };
    }
  }

  // Veritabanında iade işlemini gerçekleştir
  const { data: refundResult, error: refundError } = await adminClient.rpc("refund_order", {
    p_order_id: order.id,
    p_final_status: "CANCELED",
    p_reason: "Kullanıcı tarafından iptal edildi",
  });

  if (refundError) {
    return { success: false, error: "İade işlemi sırasında hata: " + refundError.message };
  }

  return { success: true, message: "Sipariş iptal edildi ve bakiyeniz iade edildi.", refundResult };
}

/**
 * Kullanıcı Profil ve Bakiye Bilgisi
 */
export async function getUserProfileAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, balance_cents, currency, role")
    .eq("id", user.id)
    .single();

  return profile;
}

/**
 * Kullanıcı Siparişleri Listesi
 */
export async function getUserOrdersAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(25);

  return orders || [];
}

/**
 * Bakiye Yükleme (Deposit) Action'ı
 * Gerçek ortamda ödeme sağlayıcısı (Stripe, Crypto, PayTR) webhook'u tarafından çağrılır.
 */
export async function depositAction(amountCents: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Lütfen önce giriş yapın." };
  }

  if (!amountCents || amountCents <= 0) {
    return { success: false, error: "Geçersiz yükleme tutarı." };
  }

  const adminClient = getAdminClient();
  const reference = `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const { data: result, error } = await adminClient.rpc("adjust_balance", {
    p_user_id: user.id,
    p_amount_cents: amountCents,
    p_type: "deposit",
    p_reference: reference,
    p_description: `Test / Otomatik Bakiye Yükleme (+${amountCents / 100} USD)`,
  });

  if (error) {
    return { success: false, error: "Bakiye yüklenemedi: " + error.message };
  }

  const row = Array.isArray(result) ? result[0] : result;
  return { success: true, balanceCents: row?.balance_cents ?? 0 };
}

