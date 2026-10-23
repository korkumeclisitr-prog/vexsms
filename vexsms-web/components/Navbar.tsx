"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Wallet,
  Plus,
  Zap,
  RefreshCw,
  User,
  LogIn,
  LogOut,
  ChevronDown,
  Shield,
} from "lucide-react";
import { formatCents } from "@/lib/utils";

interface NavbarProps {
  balanceCents: number;
  currency?: string;
  user: {
    id?: string;
    email: string;
    fullName?: string;
  } | null;
  onRefresh?: () => void;
  onOpenDeposit?: () => void;
  onSignOut?: () => void;
}

export function Navbar({
  balanceCents,
  currency = "USD",
  user,
  onRefresh,
  onOpenDeposit,
  onSignOut,
}: NavbarProps) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dışarı tıklandığında menüyü kapat
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDepositClick = () => {
    if (!user) {
      router.push("/login");
      return;
    }
    onOpenDeposit?.();
  };

  const handleProfileClick = () => {
    if (!user) {
      router.push("/login");
      return;
    }
    setDropdownOpen((prev) => !prev);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20 transition-transform group-hover:scale-105">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white">
                Vex<span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">SMS</span>
              </span>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">Yüksek Güvenlikli Sanal Numara & OTP</p>
          </div>
        </Link>

        {/* Center / Stats Pill */}
        <div className="hidden md:flex items-center gap-6 text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>5sim API: <span className="font-medium text-emerald-400">Aktif & Stabil</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
            <span>PostgreSQL RPC & RLS Korumalı</span>
          </div>
        </div>

        {/* Right actions: Balance & Profile */}
        <div className="flex items-center gap-3">
          {/* Balance Pill */}
          <div
            onClick={handleDepositClick}
            className="flex items-center rounded-xl border border-neutral-800 bg-neutral-900/90 p-1 pl-3 shadow-inner cursor-pointer hover:border-neutral-700 transition"
          >
            <div className="flex items-center gap-2 pr-3">
              <Wallet className="h-4 w-4 text-emerald-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-neutral-400 leading-none">Bakiye</span>
                <span className="text-sm font-bold text-white leading-tight">
                  {user ? formatCents(balanceCents, currency) : "Giriş Yap"}
                </span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDepositClick();
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-2.5 text-xs font-medium text-white transition hover:from-emerald-500 hover:to-teal-500 active:scale-95 shadow-sm shadow-emerald-500/20"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Yükle</span>
            </button>
          </div>

          {/* Refresh Action */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Yenile"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white hover:border-neutral-700 transition"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}

          {/* User Profile / Auth Area */}
          <div className="relative pl-1 border-l border-neutral-800" ref={dropdownRef}>
            {user ? (
              <div>
                <button
                  onClick={handleProfileClick}
                  className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 pr-2.5 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-800/80 transition"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 text-xs font-bold text-white uppercase shadow-sm">
                    {user.email.slice(0, 2)}
                  </div>
                  <span className="hidden sm:inline-block max-w-[120px] truncate text-xs font-medium">
                    {user.fullName || user.email.split("@")[0]}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
                </button>

                {/* Dropdown Menu */}
                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-neutral-800 bg-neutral-900/95 p-2 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 z-50">
                    <div className="border-b border-neutral-800 p-3">
                      <p className="text-[11px] font-medium text-neutral-400">Giriş Yapılan Hesap</p>
                      <p className="mt-0.5 text-xs font-semibold text-white truncate">{user.email}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-neutral-400">Kullanılabilir Bakiye:</span>
                        <span className="text-xs font-bold text-emerald-400">
                          {formatCents(balanceCents, currency)}
                        </span>
                      </div>
                    </div>

                    <div className="p-1 space-y-1">
                      <button
                        onClick={() => {
                          setDropdownOpen(false);
                          onOpenDeposit?.();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-800 hover:text-white transition"
                      >
                        <Wallet className="h-4 w-4 text-emerald-400" />
                        <span>Bakiye Yükle</span>
                      </button>

                      <button
                        onClick={() => {
                          setDropdownOpen(false);
                          onSignOut?.();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Çıkış Yap (Sign Out)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => router.push("/login")}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:from-cyan-500 hover:to-indigo-500 transition active:scale-95"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Giriş Yap</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
