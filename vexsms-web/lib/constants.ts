export interface PopularService {
  slug: string;
  name: string;
  category: string;
  iconBg: string;
}

export const POPULAR_SERVICES: PopularService[] = [
  { slug: "wa", name: "WhatsApp", category: "Mesajlaşma", iconBg: "from-emerald-500/20 to-green-600/20 text-emerald-400" },
  { slug: "tg", name: "Telegram", category: "Mesajlaşma", iconBg: "from-sky-500/20 to-blue-600/20 text-sky-400" },
  { slug: "go", name: "Google / Gmail", category: "E-Posta", iconBg: "from-red-500/20 to-amber-600/20 text-amber-400" },
  { slug: "openai", name: "ChatGPT / OpenAI", category: "Yapay Zeka", iconBg: "from-teal-500/20 to-emerald-600/20 text-teal-300" },
  { slug: "ds", name: "Discord", category: "Topluluk", iconBg: "from-indigo-500/20 to-violet-600/20 text-indigo-400" },
  { slug: "ig", name: "Instagram", category: "Sosyal Medya", iconBg: "from-pink-500/20 to-rose-600/20 text-pink-400" },
  { slug: "tw", name: "Twitter / X", category: "Sosyal Medya", iconBg: "from-neutral-700/40 to-neutral-800/40 text-neutral-200" },
  { slug: "vi", name: "Viber", category: "Mesajlaşma", iconBg: "from-purple-500/20 to-violet-600/20 text-purple-400" },
  { slug: "oi", name: "Tinder", category: "Sosyal", iconBg: "from-rose-500/20 to-orange-500/20 text-rose-400" },
  { slug: "fb", name: "Facebook", category: "Sosyal Medya", iconBg: "from-blue-600/20 to-blue-700/20 text-blue-400" },
  { slug: "mb", name: "Yahoo", category: "E-Posta", iconBg: "from-purple-600/20 to-indigo-600/20 text-purple-300" },
  { slug: "lf", name: "TikTok", category: "Sosyal Medya", iconBg: "from-cyan-500/20 to-pink-500/20 text-cyan-300" },
];

export interface DefaultCountry {
  slug: string;
  name: string;
  code: string;
  flag: string;
}

export const POPULAR_COUNTRIES: DefaultCountry[] = [
  { slug: "usa", name: "Amerika Birleşik Devletleri", code: "US", flag: "🇺🇸" },
  { slug: "england", name: "Birleşik Krallık", code: "GB", flag: "🇬🇧" },
  { slug: "germany", name: "Almanya", code: "DE", flag: "🇩🇪" },
  { slug: "netherlands", name: "Hollanda", code: "NL", flag: "🇳🇱" },
  { slug: "turkey", name: "Türkiye", code: "TR", flag: "🇹🇷" },
  { slug: "france", name: "Fransa", code: "FR", flag: "🇫🇷" },
  { slug: "canada", name: "Kanada", code: "CA", flag: "🇨🇦" },
  { slug: "poland", name: "Polonya", code: "PL", flag: "🇵🇱" },
  { slug: "spain", name: "İspanya", code: "ES", flag: "🇪🇸" },
  { slug: "brazil", name: "Brezilya", code: "BR", flag: "🇧🇷" },
  { slug: "indonesia", name: "Endonezya", code: "ID", flag: "🇮🇩" },
  { slug: "india", name: "Hindistan", code: "IN", flag: "🇮🇳" },
];
