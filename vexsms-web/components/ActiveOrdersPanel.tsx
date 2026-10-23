"use client";

import React, { useState, useEffect } from "react";
import {
  Phone,
  Copy,
  Check,
  Clock,
  RotateCcw,
  AlertCircle,
  Sparkles,
  MessageSquare,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { formatCents } from "@/lib/utils";

export interface OrderItem {
  id: string;
  provider_order_id: number | null;
  country: string;
  operator: string;
  product: string;
  phone: string | null;
  price_cents: number;
  status: "RESERVING" | "PENDING" | "RECEIVED" | "FINISHED" | "CANCELED" | "TIMEOUT" | "BANNED" | "FAILED";
  sms_code: string | null;
  sms_text: string | null;
  sms_sender: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ActiveOrdersPanelProps {
  orders: OrderItem[];
  onCheckOrder: (id: string) => Promise<void>;
  onCancelOrder: (id: string) => Promise<void>;
}

export function ActiveOrdersPanel({
  orders,
  onCheckOrder,
  onCancelOrder,
}: ActiveOrdersPanelProps) {
  const activeOrders = orders.filter(
    (o) => o.status === "PENDING" || o.status === "RESERVING" || o.status === "RECEIVED"
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <h2 className="text-base font-semibold text-white">Aktif Sanal Numaralar</h2>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300">
            {activeOrders.length}
          </span>
        </div>
        <p className="text-xs text-neutral-400">
          Otomatik yenileme aktif • SMS gelmezse ücret iade edilir
        </p>
      </div>

      {activeOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-800/80 bg-neutral-900/40 p-10 text-center backdrop-blur-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800/60 text-neutral-400 mb-3 border border-neutral-700/50">
            <Phone className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-medium text-neutral-200">Henüz aktif bir numaranız yok</h3>
          <p className="mt-1 text-xs text-neutral-400 max-w-sm">
            Yukarıdaki panelden ülke ve servis seçerek hemen tek tıkla sanal numaranızı kiralayabilirsiniz.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activeOrders.map((order) => (
            <ActiveOrderCard
              key={order.id}
              order={order}
              onCheckOrder={onCheckOrder}
              onCancelOrder={onCancelOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveOrderCard({
  order,
  onCheckOrder,
  onCancelOrder,
}: {
  order: OrderItem;
  onCheckOrder: (id: string) => Promise<void>;
  onCancelOrder: (id: string) => Promise<void>;
}) {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(900); // 15 mins default
  const [isChecking, setIsChecking] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);

  // Geri sayım sayacı
  useEffect(() => {
    if (!order.expires_at) return;

    const updateTimer = () => {
      const expiresTime = new Date(order.expires_at!).getTime();
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((expiresTime - now) / 1000));
      setTimeLeftSeconds(diffSec);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [order.expires_at]);

  // Her 5 saniyede bir otomatik SMS kontrolü (SMS henüz gelmediyse)
  useEffect(() => {
    if (order.status !== "PENDING" || order.sms_code) return;

    const interval = setInterval(() => {
      onCheckOrder(order.id);
    }, 5000);

    return () => clearInterval(interval);
  }, [order.id, order.status, order.sms_code, onCheckOrder]);

  const copyToClipboard = (text: string, type: "phone" | "code") => {
    navigator.clipboard.writeText(text);
    if (type === "phone") {
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleManualCheck = async () => {
    setIsChecking(true);
    try {
      await onCheckOrder(order.id);
    } finally {
      setIsChecking(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Siparişi iptal edip bakiyenizi iade almak istiyor musunuz?")) return;
    setIsCanceling(true);
    try {
      await onCancelOrder(order.id);
    } finally {
      setIsCanceling(false);
    }
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const hasCode = !!order.sms_code;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 ${
        hasCode
          ? "border-emerald-500/50 bg-gradient-to-b from-emerald-950/20 via-neutral-900/90 to-neutral-900 shadow-xl shadow-emerald-500/10"
          : "border-neutral-800 bg-neutral-900/70 hover:border-neutral-700 shadow-lg"
      } p-5`}
    >
      {/* Glow highlight */}
      <div
        className={`absolute -right-12 -top-12 h-36 w-36 rounded-full blur-3xl pointer-events-none ${
          hasCode ? "bg-emerald-500/20" : "bg-cyan-500/10"
        }`}
      />

      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 border border-neutral-700 text-xs font-bold text-white uppercase">
            {order.product.slice(0, 3)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white capitalize">{order.product}</span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 uppercase">
                {order.country}
              </span>
              <span className="text-[10px] text-neutral-400">({order.operator})</span>
            </div>
            <span className="text-[11px] text-neutral-400">
              Ücret: {formatCents(order.price_cents)}
            </span>
          </div>
        </div>

        {/* Countdown Pill */}
        <div
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono font-medium ${
            timeLeftSeconds < 120
              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
              : "bg-neutral-800/90 text-neutral-300 border border-neutral-700/50"
          }`}
        >
          <Clock className="h-3.5 w-3.5 text-neutral-400" />
          <span>{formatCountdown(timeLeftSeconds)}</span>
        </div>
      </div>

      {/* Phone Number Display */}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
            Sanal Telefon Numarası
          </span>
          <div className="font-mono text-lg font-bold tracking-tight text-white">
            {order.phone || "Numara atanıyor..."}
          </div>
        </div>

        {order.phone && (
          <button
            onClick={() => copyToClipboard(order.phone!, "phone")}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 active:scale-95"
          >
            {copiedPhone ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400">Kopyalandı</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Kopyala</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* SMS Status & OTP Area */}
      <div className="mt-4">
        {hasCode ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Sparkles className="h-4 w-4" />
                <span>SMS DOĞRULAMA KODU ALINDI</span>
              </div>
              <span className="text-[11px] text-neutral-400">{order.sms_sender || "SMS"}</span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 font-mono text-2xl font-black tracking-widest text-emerald-300 bg-neutral-950/80 px-4 py-2 rounded-lg border border-emerald-500/30">
                {order.sms_code}
              </div>

              <button
                onClick={() => copyToClipboard(order.sms_code!, "code")}
                className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 text-xs font-bold text-white shadow-md shadow-emerald-600/30 transition hover:from-emerald-500 hover:to-teal-500 active:scale-95"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>KOPYALANDI!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>KODU KOPYALA</span>
                  </>
                )}
              </button>
            </div>

            {order.sms_text && (
              <p className="mt-2.5 text-xs text-neutral-400 bg-neutral-900/60 p-2 rounded border border-neutral-800 font-sans break-all">
                {order.sms_text}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-950/30 p-4 text-center">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-xs font-medium text-neutral-300">
                SMS bekleniyor... (Uygulamaya girin)
              </span>
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
              Kodu aldığınız anda bu ekranda parlayarak görünecektir.
            </p>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-neutral-800/80 pt-3">
        <button
          onClick={handleManualCheck}
          disabled={isChecking || hasCode}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white disabled:opacity-50 transition"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${isChecking ? "animate-spin text-cyan-400" : ""}`} />
          <span>{isChecking ? "Kontrol Ediliyor..." : "Şimdi Kontrol Et"}</span>
        </button>

        {!hasCode && (
          <button
            onClick={handleCancel}
            disabled={isCanceling}
            className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 transition hover:bg-rose-500/20 active:scale-95 disabled:opacity-50"
          >
            {isCanceling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldAlert className="h-3 w-3" />
            )}
            <span>İptal Et & İade Al</span>
          </button>
        )}
      </div>
    </div>
  );
}
