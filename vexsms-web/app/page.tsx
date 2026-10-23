"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { ServiceCountrySelector } from "@/components/ServiceCountrySelector";
import { ActiveOrdersPanel, OrderItem } from "@/components/ActiveOrdersPanel";
import { OrdersHistoryTable } from "@/components/OrdersHistoryTable";
import { DepositModal } from "@/components/DepositModal";
import {
  buyNumberAction,
  checkOrderAction,
  cancelOrderAction,
  getUserProfileAction,
  getUserOrdersAction,
  depositAction,
} from "@/app/actions/order";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle, CheckCircle, Sparkles, Shield, Zap } from "lucide-react";

interface CurrentUser {
  id: string;
  email: string;
  fullName?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const showBanner = (type: "success" | "error" | "info", text: string) => {
    setBannerMessage({ type, text });
    setTimeout(() => {
      setBannerMessage(null);
    }, 6000);
  };

  // 1. Veri Yükleme (Kullanıcı, Profil & Siparişler)
  const refreshData = useCallback(async () => {
    try {
      const profile = await getUserProfileAction();
      if (profile) {
        setCurrentUser({
          id: profile.id,
          email: profile.email || "",
          fullName: profile.full_name || "",
        });
        if (typeof profile.balance_cents === "number") {
          setBalanceCents(profile.balance_cents);
        }
      } else {
        // Oturum açılmamış
        setCurrentUser(null);
        setBalanceCents(0);
      }

      const userOrders = await getUserOrdersAction();
      if (Array.isArray(userOrders)) {
        setOrders(userOrders as OrderItem[]);
      }
    } catch {
      // Çevrimdışı / İlk kurulum durumunda sessizce devam et
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // 2. Supabase Auth State Dinleme & Realtime Akışı
  useEffect(() => {
    let supabase: ReturnType<typeof createClient> | null = null;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    if (!supabase) return;

    // Auth oturum durumu değişimini anlık yakala
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setCurrentUser({
          id: session.user.id,
          email: session.user.email || "",
          fullName: session.user.user_metadata?.full_name || "",
        });
        refreshData();
      } else {
        setCurrentUser(null);
        setOrders([]);
        setBalanceCents(0);
      }
    });

    // Sipariş güncellemeleri dinleyicisi (Ör. SMS kodu geldiğinde)
    const ordersChannel = supabase
      .channel("realtime:orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newOrder = payload.new as OrderItem;
            setOrders((prev) => [newOrder, ...prev.filter((o) => o.id !== newOrder.id)]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as OrderItem;
            setOrders((prev) =>
              prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
            );

            // Eğer yeni SMS kodu geldiyse sesli / görsel uyarı göster
            if (updated.sms_code) {
              showBanner(
                "success",
                `YENİ SMS KODU ALINDI! [${updated.sms_code}] (${updated.product.toUpperCase()})`
              );
            }
          }
        }
      )
      .subscribe();

    // Bakiye güncellemeleri dinleyicisi
    const profileChannel = supabase
      .channel("realtime:profiles")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const newProfile = payload.new as { balance_cents: number };
          if (newProfile && typeof newProfile.balance_cents === "number") {
            setBalanceCents(newProfile.balance_cents);
          }
        }
      )
      .subscribe();

    return () => {
      authSub?.unsubscribe();
      supabase?.removeChannel(ordersChannel);
      supabase?.removeChannel(profileChannel);
    };
  }, [refreshData]);

  // 3. Çıkış Yapma Handler'ı
  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    await signOutAction();
    setCurrentUser(null);
    setOrders([]);
    setBalanceCents(0);
    showBanner("info", "Başarıyla çıkış yapıldı.");
  };

  // 4. Numara Satın Alma Handler'ı
  const handleBuyNumber = async (params: {
    country: string;
    operator: string;
    product: string;
  }) => {
    if (!currentUser) {
      showBanner("info", "Numara satın alabilmek için lütfen giriş yapın.");
      router.push("/login");
      return;
    }

    setIsPurchasing(true);
    try {
      const result = await buyNumberAction(params);

      if (!result.success) {
        if (result.code === "UNAUTHORIZED") {
          router.push("/login");
          return;
        }
        showBanner("error", result.error || "Numara alınamadı.");
        return;
      }

      showBanner(
        "success",
        `Numaranız başarıyla tahsis edildi: ${result.order.phone}. SMS kodu bekleniyor...`
      );

      // Listeye ekle ve bakiye güncelle
      const newOrderItem: OrderItem = {
        id: result.order.id,
        provider_order_id: result.order.providerOrderId,
        country: result.order.country,
        operator: result.order.operator,
        product: result.order.product,
        phone: result.order.phone,
        price_cents: result.order.priceCents,
        status: "PENDING",
        sms_code: null,
        sms_text: null,
        sms_sender: null,
        expires_at: result.order.expiresAt,
        created_at: new Date().toISOString(),
      };

      setOrders((prev) => [newOrderItem, ...prev]);
      if (typeof result.balanceCents === "number") {
        setBalanceCents(result.balanceCents);
      }
    } catch (err: any) {
      showBanner("error", err?.message || "Beklenmeyen bir hata oluştu.");
    } finally {
      setIsPurchasing(false);
    }
  };

  // 5. SMS Kontrol Handler'ı
  const handleCheckOrder = async (orderId: string) => {
    try {
      const result = await checkOrderAction(orderId);
      if (result.success && result.order) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, ...result.order } : o))
        );
      }
    } catch {
      // Hata sessizce yönetilir
    }
  };

  // 6. İptal ve İade Handler'ı
  const handleCancelOrder = async (orderId: string) => {
    try {
      const result = await cancelOrderAction(orderId);
      if (!result.success) {
        showBanner("error", result.error || "İptal işlemi başarısız.");
        return;
      }

      showBanner("info", result.message || "Sipariş iptal edildi ve bakiye iade edildi.");
      refreshData();
    } catch (err: any) {
      showBanner("error", err?.message || "İptal sırasında hata oluştu.");
    }
  };

  // 7. Bakiye Yükleme Handler'ı
  const handleDeposit = async (cents: number) => {
    if (!currentUser) {
      router.push("/login");
      return;
    }

    try {
      const result = await depositAction(cents);
      if (result.success && typeof result.balanceCents === "number") {
        setBalanceCents(result.balanceCents);
        showBanner("success", `Bakiyeniz başarıyla güncellendi: $${cents / 100} yüklendi.`);
      } else {
        showBanner("error", result.error || "Bakiye yükleme başarısız.");
      }
    } catch {
      showBanner("error", "Bakiye yüklenirken bir hata oluştu.");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navbar */}
      <Navbar
        balanceCents={balanceCents}
        user={currentUser}
        onRefresh={refreshData}
        onOpenDeposit={() => setIsDepositOpen(true)}
        onSignOut={handleSignOut}
      />

      {/* Hero Banner Notification */}
      {bannerMessage && (
        <div
          className={`sticky top-16 z-30 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold shadow-md transition-all ${
            bannerMessage.type === "success"
              ? "bg-emerald-600 text-white"
              : bannerMessage.type === "error"
              ? "bg-rose-600 text-white"
              : "bg-cyan-600 text-white"
          }`}
        >
          {bannerMessage.type === "success" ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span>{bannerMessage.text}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Intro Tagline */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-neutral-800/80 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Sanal Numara & SMS Doğrulama Platformu
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              WhatsApp, Telegram, Google ve yüzlerce platform için anlık OTP aktivasyon kodları.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3.5 py-2 text-xs text-neutral-300">
              <Shield className="h-4 w-4 text-emerald-400" />
              <span>Otomatik İade Garantisi</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3.5 py-2 text-xs text-neutral-300">
              <Zap className="h-4 w-4 text-cyan-400" />
              <span>Anlık Kod Akışı</span>
            </div>
          </div>
        </div>

        {/* 1. Ülke & Servis Seçici */}
        <ServiceCountrySelector
          balanceCents={balanceCents}
          onBuyNumber={handleBuyNumber}
          isPurchasing={isPurchasing}
        />

        {/* 2. Aktif Sanal Numaralar & Geri Sayım Paneli */}
        <ActiveOrdersPanel
          orders={orders}
          onCheckOrder={handleCheckOrder}
          onCancelOrder={handleCancelOrder}
        />

        {/* 3. Geçmiş Siparişler & Muhasebe Defteri */}
        <OrdersHistoryTable orders={orders} />
      </main>

      {/* Bakiye Yükleme Modalı */}
      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onDeposit={handleDeposit}
        balanceCents={balanceCents}
      />

      {/* Footer */}
      <footer className="border-t border-neutral-800/80 bg-neutral-950/60 py-6 text-center text-xs text-neutral-400">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>© 2026 VexSMS Enterprise SaaS. Tüm hakları saklıdır.</span>
          <span className="flex items-center gap-2 text-neutral-400">
            Powered by 5sim API & Supabase PostgreSQL
          </span>
        </div>
      </footer>
    </div>
  );
}
