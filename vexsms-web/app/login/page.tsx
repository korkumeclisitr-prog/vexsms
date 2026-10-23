"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Zap,
  Mail,
  Lock,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Smartphone,
  RefreshCw,
} from "lucide-react";
import { signInAction, signUpAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Zaten giriş yapmış kullanıcıyı kontrol et ve yönlendir
  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          router.replace("/");
        }
      });
    } catch {
      // Offline/demo ortamı
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const result = await signInAction({ email, password });
        if (!result.success) {
          setErrorMessage(result.error);
          setLoading(false);
          return;
        }

        setSuccessMessage("Giriş başarılı! Yönlendiriliyorsunuz...");
        // Tarayıcıdaki auth state'i senkronlamak için kısa bekleme
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 600);
      } else {
        const result = await signUpAction({ email, password, fullName });
        if (!result.success) {
          setErrorMessage(result.error);
          setLoading(false);
          return;
        }

        if (result.requiresEmailConfirmation) {
          setSuccessMessage(result.message || "Lütfen e-posta adresinizi onaylayın.");
          setLoading(false);
        } else {
          setSuccessMessage("Hesabınız oluşturuldu! Yönlendiriliyorsunuz...");
          setTimeout(() => {
            router.push("/");
            router.refresh();
          }, 800);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "İşlem sırasında bir hata oluştu.");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-center items-center px-4 py-12 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Arka Plan Glow Efektleri */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-indigo-600/15 blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 left-1/3 -translate-x-1/2 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 right-1/3 h-72 w-72 rounded-full bg-purple-600/15 blur-[100px] pointer-events-none" />

      {/* Ana Konteyner */}
      <div className="relative z-10 w-full max-w-md">
        {/* Brand Başlığı */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/25 transition-transform group-hover:scale-105">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black tracking-tight text-white">
                  Vex<span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">SMS</span>
                </span>
                <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">
                  PRO
                </span>
              </div>
              <p className="text-xs text-neutral-400">SaaS Sanal Numara & OTP Doğrulama</p>
            </div>
          </Link>
        </div>

        {/* Auth Kartı */}
        <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/80 p-8 shadow-2xl backdrop-blur-xl">
          {/* Tab Seçici (Giriş Yap / Kayıt Ol) */}
          <div className="flex rounded-xl bg-neutral-950/80 p-1 border border-neutral-800 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                mode === "signin"
                  ? "bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-white border border-cyan-500/30 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Giriş Yap
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                mode === "signup"
                  ? "bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-white border border-cyan-500/30 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Kayıt Ol
            </button>
          </div>

          {/* Başlık ve Açıklama */}
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white">
              {mode === "signin" ? "Hesabınıza Giriş Yapın" : "Yeni Hesap Oluşturun"}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              {mode === "signin"
                ? "Sanal numaralarınızı yönetmek ve anlık SMS almak için giriş yapın."
                : "Hemen kaydolun ve bakiye yükleyerek sanal numara kiralamaya başlayın."}
            </p>
          </div>

          {/* Hata ve Başarı Mesaj Kutuları */}
          {errorMessage && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 animate-in fade-in">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Ad Soyad (Sadece Kayıt modunda) */}
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Ad Soyad
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3 h-4 w-4 text-neutral-500" />
                  <input
                    type="text"
                    required
                    placeholder="Adınız Soyadınız"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 py-2.5 pl-10 pr-4 text-xs text-white placeholder-neutral-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
                  />
                </div>
              </div>
            )}

            {/* E-posta */}
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                E-posta Adresi
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-neutral-500" />
                <input
                  type="email"
                  required
                  placeholder="ornek@vexsms.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 py-2.5 pl-10 pr-4 text-xs text-white placeholder-neutral-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
                />
              </div>
            </div>

            {/* Şifre */}
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Şifre
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-neutral-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 py-2.5 pl-10 pr-10 text-xs text-white placeholder-neutral-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3 text-neutral-500 hover:text-neutral-300 transition"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "signup" && (
                <p className="mt-1 text-[11px] text-neutral-500">
                  En az 6 karakterden oluşmalıdır.
                </p>
              )}
            </div>

            {/* Giriş Butonu */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 px-4 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-cyan-400 hover:to-purple-500 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>İşlem yapılıyor...</span>
                </>
              ) : (
                <>
                  <span>{mode === "signin" ? "Giriş Yap" : "Hesap Oluştur"}</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Alt Bilgi */}
          <div className="mt-6 border-t border-neutral-800/80 pt-4 text-center">
            <Link
              href="/"
              className="text-xs text-neutral-400 hover:text-cyan-400 transition inline-flex items-center gap-1"
            >
              ← Ana Sayfaya Dön
            </Link>
          </div>
        </div>

        {/* Güvenlik & Özellik Rozetleri */}
        <div className="mt-8 grid grid-cols-3 gap-3 text-center text-[11px] text-neutral-400">
          <div className="flex flex-col items-center gap-1 p-2 rounded-xl bg-neutral-900/40 border border-neutral-800/60">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>RLS Korumalı</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-2 rounded-xl bg-neutral-900/40 border border-neutral-800/60">
            <Smartphone className="h-4 w-4 text-cyan-400" />
            <span>5sim API</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-2 rounded-xl bg-neutral-900/40 border border-neutral-800/60">
            <RefreshCw className="h-4 w-4 text-purple-400" />
            <span>Otomatik İade</span>
          </div>
        </div>
      </div>
    </div>
  );
}
