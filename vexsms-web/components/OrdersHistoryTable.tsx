"use client";

import React, { useState } from "react";
import { History, CheckCircle2, XCircle, Clock, Search, ArrowUpRight } from "lucide-react";
import { OrderItem } from "@/components/ActiveOrdersPanel";
import { formatCents } from "@/lib/utils";

interface OrdersHistoryTableProps {
  orders: OrderItem[];
}

export function OrdersHistoryTable({ orders }: OrdersHistoryTableProps) {
  const [search, setSearch] = useState("");

  const pastOrders = orders.filter(
    (o) => !["PENDING", "RESERVING"].includes(o.status)
  );

  const filtered = pastOrders.filter((o) =>
    (o.phone || "").includes(search) ||
    o.product.toLowerCase().includes(search.toLowerCase()) ||
    o.country.toLowerCase().includes(search.toLowerCase()) ||
    (o.sms_code || "").includes(search)
  );

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Geçmiş Siparişler & Muhasebe Defteri</h3>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
            {pastOrders.length}
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            placeholder="Numara veya servis ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64 rounded-xl border border-neutral-800 bg-neutral-950/80 py-1.5 pl-8 pr-3 text-xs text-white placeholder-neutral-400 outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-xs text-neutral-400">
          Geçmiş sipariş kaydı bulunmuyor.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-300">
            <thead className="border-b border-neutral-800 text-[11px] uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="py-2.5 pr-4 font-medium">Tarih</th>
                <th className="py-2.5 px-4 font-medium">Servis & Ülke</th>
                <th className="py-2.5 px-4 font-medium">Telefon</th>
                <th className="py-2.5 px-4 font-medium">Gelen Kod (OTP)</th>
                <th className="py-2.5 px-4 font-medium">Tutar</th>
                <th className="py-2.5 pl-4 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60">
              {filtered.map((order) => {
                const dateStr = new Date(order.created_at).toLocaleString("tr-TR", {
                  dateStyle: "short",
                  timeStyle: "short",
                });

                return (
                  <tr key={order.id} className="hover:bg-neutral-800/30 transition">
                    <td className="py-3 pr-4 text-neutral-400 whitespace-nowrap">{dateStr}</td>
                    <td className="py-3 px-4 font-medium text-white capitalize whitespace-nowrap">
                      {order.product} <span className="text-neutral-400 uppercase text-[10px]">({order.country})</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-300 whitespace-nowrap">
                      {order.phone || "—"}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {order.sms_code ? (
                        <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {order.sms_code}
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium text-neutral-200 whitespace-nowrap">
                      {formatCents(order.price_cents)}
                    </td>
                    <td className="py-3 pl-4 whitespace-nowrap">
                      <StatusBadge status={order.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: OrderItem["status"] }) {
  switch (status) {
    case "RECEIVED":
    case "FINISHED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>Tamamlandı</span>
        </span>
      );
    case "CANCELED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
          <XCircle className="h-3 w-3" />
          <span>İptal / İade Edildi</span>
        </span>
      );
    case "TIMEOUT":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          <Clock className="h-3 w-3" />
          <span>Süre Doldu (İade)</span>
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
          <XCircle className="h-3 w-3" />
          <span>Başarısız</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
          <span>{status}</span>
        </span>
      );
  }
}
