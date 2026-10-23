"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const authSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi girin."),
  password: z.string().min(6, "Şifre en az 6 karakter olmalıdır."),
  fullName: z.string().optional(),
});

export type AuthActionResult =
  | { success: true; message?: string; requiresEmailConfirmation?: boolean }
  | { success: false; error: string };

/**
 * Kullanıcı Girişi (Sign In)
 */
export async function signInAction(rawInput: unknown): Promise<AuthActionResult> {
  const parsed = authSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Geçersiz giriş bilgileri." };
  }

  const { email, password } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { success: false, error: "E-posta veya şifre hatalı." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { success: false, error: "Lütfen e-posta adresinize gönderilen aktivasyon linkini onaylayın." };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Kullanıcı Kaydı (Sign Up)
 */
export async function signUpAction(rawInput: unknown): Promise<AuthActionResult> {
  const parsed = authSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Geçersiz kayıt bilgileri." };
  }

  const { email, password, fullName } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || email.split("@")[0],
      },
    },
  });

  if (error) {
    if (error.message.includes("User already registered")) {
      return { success: false, error: "Bu e-posta adresi zaten kayıtlı. Lütfen giriş yapın." };
    }
    return { success: false, error: error.message };
  }

  // Supabase'de e-posta doğrulaması açıksa session hemen oluşmaz (identities kontrolü)
  const requiresConfirmation = !data.session;

  return {
    success: true,
    requiresEmailConfirmation: requiresConfirmation,
    message: requiresConfirmation
      ? "Kayıt başarılı! Lütfen e-posta adresinize gelen onay bağlantısına tıklayın."
      : "Kayıt başarılı! Yönlendiriliyorsunuz...",
  };
}

/**
 * Oturum Kapatma (Sign Out)
 */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Mevcut Aktif Kullanıcıyı Getir
 */
export async function getCurrentUserAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, balance_cents, currency, role")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email || profile?.email || "",
    fullName: profile?.full_name || user.user_metadata?.full_name || "",
    avatarUrl: profile?.avatar_url || "",
    balanceCents: profile?.balance_cents ?? 0,
    role: profile?.role ?? "user",
  };
}
