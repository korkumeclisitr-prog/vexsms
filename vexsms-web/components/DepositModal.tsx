"use client";

import React, { useState } from "react";
import { X, Wallet, CreditCard, Check, Loader2, Sparkles } from "lucide-react";
import { formatCents } from "@/lib/utils";

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeposit: (cents: number) => Promise<void>;
  balanceCents: number;
}

const AMOUNTS = [
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500, popular: true },
  { label: "$50", cents: 5000 },
];

export function DepositModal({
  isOpen,
  onClose,
  onDeposit,
  balanceCents,
}: DepositModalProps) {
  const [selectedCents, setSelectedCents] = useState<number>(2500);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onDeposit(selectedCents);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Bakiye Yükle</h3>
            <p className="text-xs text-neutral-400">
              Mevcut Bakiye: <span className="font-bold text-white">{formatCents(balanceCents)}</span>
            </p>
          </div>
        </div>

        {/* Amount Selection */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-neutral-300">Yüklemek İstediğiniz Tutar:</label>
          <div className="grid grid-cols-2 gap-2.5">
            {AMOUNTS.map((amt) => {
              const isSelected = selectedCents === amt.cents;
              return (
                <button
                  key={amt.cents}
                  onClick={() => setSelectedCents(amt.cents)}
                  className={`relative flex items-center justify-between rounded-xl p-3 border text-left transition ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-500/10 text-white"
                      : "border-neutral-800 bg-neutral-950/60 text-neutral-300 hover:border-neutral-700"
                  }`}
                >
                  <span className="font-bold text-base">{amt.label}</span>
                  {amt.popular && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                      Popüler
                    </span>
                  )}
                  {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Payment Methods (Preview) */}
        <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-400">
          <div className="flex items-center gap-2 text-neutral-200 font-medium mb-1">
            <CreditCard className="h-3.5 w-3.5 text-cyan-400" />
            <span>Kredi Kartı / Kripto (USDT/BTC) / Havale</span>
          </div>
          <p className="text-[11px]">
            Test ve geliştirme modunda bakiye PostgreSQL Stored Procedure (adjust_balance) ile anında hesabınıza tanımlanır.
          </p>
        </div>

        {/* Submit */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-1/3 rounded-xl border border-neutral-800 bg-neutral-800/60 py-2.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition"
          >
            Vazgeç
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex w-2/3 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-500 hover:to-teal-500 transition disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>{formatCents(selectedCents)} Yükle</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
