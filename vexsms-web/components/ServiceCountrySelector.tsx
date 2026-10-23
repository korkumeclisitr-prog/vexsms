"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Globe2,
  Smartphone,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { POPULAR_COUNTRIES, POPULAR_SERVICES, PopularService, DefaultCountry } from "@/lib/constants";
import { formatCents } from "@/lib/utils";

interface ServiceCountrySelectorProps {
  balanceCents: number;
  onBuyNumber: (params: { country: string; operator: string; product: string }) => Promise<void>;
  isPurchasing: boolean;
}

export function ServiceCountrySelector({
  balanceCents,
  onBuyNumber,
  isPurchasing,
}: ServiceCountrySelectorProps) {
  const [selectedCountry, setSelectedCountry] = useState<DefaultCountry>(POPULAR_COUNTRIES[0]);
  const [selectedService, setSelectedService] = useState<PopularService>(POPULAR_SERVICES[0]);
  const [selectedOperator, setSelectedOperator] = useState<string>("any");

  const [countrySearch, setCountrySearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");

  // Tahmini fiyat (servis bazlı dinamik perakende hesaplama)
  const estimatedPriceCents = useMemo(() => {
    switch (selectedService.slug) {
      case "wa":
        return 75; // $0.75
      case "tg":
        return 65; // $0.65
      case "openai":
        return 50; // $0.50
      case "go":
        return 55; // $0.55
      case "ds":
        return 40; // $0.40
      case "ig":
        return 45; // $0.45
      default:
        return 50;
    }
  }, [selectedService.slug]);

  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return POPULAR_COUNTRIES;
    return POPULAR_COUNTRIES.filter((c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
    );
  }, [countrySearch]);

  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return POPULAR_SERVICES;
    return POPULAR_SERVICES.filter((s) =>
      s.name.toLowerCase().includes(serviceSearch.toLowerCase()) ||
      s.category.toLowerCase().includes(serviceSearch.toLowerCase())
    );
  }, [serviceSearch]);

  const hasSufficientBalance = balanceCents >= estimatedPriceCents;

  const handlePurchase = () => {
    onBuyNumber({
      country: selectedCountry.slug,
      operator: selectedOperator,
      product: selectedService.slug,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Sol Sütun: Ülke Seçimi (4 cols) */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur-sm lg:col-span-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">1. Ülke Seçin</h3>
          </div>
          <span className="text-[11px] text-neutral-400">{filteredCountries.length} Ülke</span>
        </div>

        {/* Ülke Arama */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          <input
            type="text"
            placeholder="Ülke ara (ABD, TR, İngiltere...)"
            value={countrySearch}
            onChange={(e) => setCountrySearch(e.target.value)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 py-2 pl-9 pr-3 text-xs text-white placeholder-neutral-400 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition"
          />
        </div>

        {/* Ülke Listesi */}
        <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
          {filteredCountries.map((c) => {
            const isSelected = selectedCountry.slug === c.slug;
            return (
              <button
                key={c.slug}
                onClick={() => setSelectedCountry(c)}
                className={`flex w-full items-center justify-between rounded-xl p-2.5 text-left text-xs transition ${
                  isSelected
                    ? "border border-cyan-500/40 bg-cyan-500/10 text-white font-medium shadow-sm shadow-cyan-500/10"
                    : "border border-transparent bg-neutral-950/40 text-neutral-300 hover:border-neutral-800 hover:bg-neutral-800/40"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg leading-none">{c.flag}</span>
                  <div>
                    <div className="text-xs font-medium text-white">{c.name}</div>
                    <span className="text-[10px] text-neutral-400">{c.code}</span>
                  </div>
                </div>
                {isSelected && <CheckCircle2 className="h-4 w-4 text-cyan-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Orta Sütun: Servis Seçimi (5 cols) */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur-sm lg:col-span-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">2. Servis / Platform Seçin</h3>
          </div>
          <span className="text-[11px] text-neutral-400">{filteredServices.length} Servis</span>
        </div>

        {/* Servis Arama */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          <input
            type="text"
            placeholder="Servis ara (WhatsApp, Telegram, OpenAI...)"
            value={serviceSearch}
            onChange={(e) => setServiceSearch(e.target.value)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 py-2 pl-9 pr-3 text-xs text-white placeholder-neutral-400 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition"
          />
        </div>

        {/* Servis Listesi */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
          {filteredServices.map((s) => {
            const isSelected = selectedService.slug === s.slug;
            return (
              <button
                key={s.slug}
                onClick={() => setSelectedService(s)}
                className={`flex flex-col justify-between rounded-xl p-3 text-left transition border ${
                  isSelected
                    ? "border-purple-500/50 bg-purple-500/10 shadow-sm shadow-purple-500/10"
                    : "border-neutral-800/80 bg-neutral-950/40 hover:border-neutral-700 hover:bg-neutral-800/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr font-bold text-xs ${s.iconBg}`}
                  >
                    {s.name.slice(0, 2)}
                  </div>
                  {isSelected && <CheckCircle2 className="h-4 w-4 text-purple-400" />}
                </div>

                <div className="mt-2.5">
                  <div className="text-xs font-semibold text-white truncate">{s.name}</div>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-neutral-400">
                    <span>{s.category}</span>
                    <span className="text-emerald-400 font-medium">Stokta</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sağ Sütun: Sipariş Özeti ve Satın Alma (3 cols) */}
      <div className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900/90 to-neutral-950 p-5 shadow-xl lg:col-span-3">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">3. Sipariş Özeti</h3>
          </div>

          <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Ülke:</span>
              <span className="font-medium text-white flex items-center gap-1.5">
                <span>{selectedCountry.flag}</span>
                <span>{selectedCountry.name}</span>
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Servis:</span>
              <span className="font-semibold text-purple-300">{selectedService.name}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Operatör:</span>
              <select
                value={selectedOperator}
                onChange={(e) => setSelectedOperator(e.target.value)}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1 text-[11px] text-white outline-none focus:border-cyan-500"
              >
                <option value="any">Otomatik (En İyi)</option>
                <option value="virtual">Virtual</option>
                <option value="tele2">Tele2</option>
                <option value="beeline">Beeline</option>
              </select>
            </div>

            <div className="border-t border-neutral-800 pt-2.5 flex items-center justify-between">
              <span className="text-neutral-400">Birim Ücret:</span>
              <span className="font-mono text-base font-bold text-emerald-400">
                {formatCents(estimatedPriceCents)}
              </span>
            </div>
          </div>

          {/* Bakiye Yetersiz Uyarısı */}
          {!hasSufficientBalance && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <span>
                Yetersiz bakiye. Mevcut bakiyeniz: <b>{formatCents(balanceCents)}</b>. Lütfen bakiye yükleyin.
              </span>
            </div>
          )}
        </div>

        {/* Satın Alma Butonu */}
        <div className="mt-5">
          <button
            onClick={handlePurchase}
            disabled={isPurchasing || !hasSufficientBalance}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 px-4 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-cyan-400 hover:to-purple-500 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPurchasing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Numara Alınıyor...</span>
              </>
            ) : (
              <>
                <span>Hemen Numara Satın Al</span>
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
          <p className="mt-2 text-center text-[10px] text-neutral-400">
            SMS gelmezse veya 15 dk içinde kod ulaşmazsa tam iade yapılır.
          </p>
        </div>
      </div>
    </div>
  );
}
