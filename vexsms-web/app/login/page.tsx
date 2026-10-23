'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  'https://zdblltfiqfttktkepubr.supabase.co',
  'sb_publishable_s8L40TFgladKkyiOu1gOXQ_yWX0-2l9'
)

function mapAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'E-posta adresi veya şifre hatalı.'
  }
  if (message.includes('Email not confirmed')) {
    return 'Lütfen e-posta adresinize gönderilen doğrulama linkine tıklayarak hesabınızı onaylayın.'
  }
  if (message.includes('User already registered')) {
    return 'Bu e-posta adresi ile zaten kayıtlı bir hesap var. Lütfen giriş yapın.'
  }
  if (message.includes('Password should be at least 6 characters')) {
    return 'Şifreniz en az 6 karakter olmalıdır.'
  }
  if (message.includes('rate limit') || message.includes('over_email_send_rate_limit')) {
    return 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.'
  }
  return message
}

export default function LoginPage() {
  const router = useRouter()
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Oturumu kontrol et; zaten giriş yapılmışsa ana sayfaya yönlendir
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/')
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.push('/')
        router.refresh()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (isLogin) {
        // Giriş Yap - Doğrudan Supabase istemci çağrısı
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError

        if (data.session) {
          router.push('/')
          router.refresh()
        }
      } else {
        // Kayıt Ol - Doğrudan Supabase istemci çağrısı
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() }
          }
        })
        if (signUpError) throw signUpError

        if (data.session) {
          router.push('/')
          router.refresh()
        } else {
          setSuccess('Kayıt başarılı! E-posta onay linki gerekiyorsa lütfen gelen kutunuzu kontrol edin ve giriş yapın.')
          setIsLogin(true)
        }
      }
    } catch (err: any) {
      setError(mapAuthError(err?.message || 'Bir hata oluştu'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-md bg-[#131b2e] border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-cyan-500/20">
            ⚡
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              VexSMS <span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded font-semibold">PRO</span>
            </h1>
            <p className="text-xs text-slate-400">SaaS Sanal Numara & OTP Doğrulama</p>
          </div>
        </div>

        <div className="flex bg-slate-900/60 p-1 rounded-xl mb-6 border border-slate-800">
          <button
            type="button"
            onClick={() => { setIsLogin(true); setError(null); setSuccess(null); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${isLogin ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            Giriş Yap
          </button>
          <button
            type="button"
            onClick={() => { setIsLogin(false); setError(null); setSuccess(null); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${!isLogin ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            Kayıt Ol
          </button>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold">{isLogin ? 'Hesabınıza Giriş Yapın' : 'Yeni Hesap Oluşturun'}</h2>
          <p className="text-xs text-slate-400 mt-1">
            {isLogin ? 'Sanal numaralarınızı yönetmek ve anlık SMS almak için giriş yapın.' : 'Hemen kaydolun ve bakiye yükleyerek sanal numara kiralamaya başlayın.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <span>⚠️</span> {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
            <span>✓</span> {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Ad Soyad</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Adınız Soyadınız"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-cyan-500 text-white placeholder-slate-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">E-posta Adresi</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@gmail.com"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-cyan-500 text-white placeholder-slate-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Şifre</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-cyan-500 text-white placeholder-slate-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/25 disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'İşleniyor...' : isLogin ? 'Giriş Yap →' : 'Hesap Oluştur →'}
          </button>
        </form>
      </div>
    </div>
  )
}