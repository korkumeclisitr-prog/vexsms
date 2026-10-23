import { NextResponse } from "next/server";
import { getCountries, getPrices } from "@/lib/5sim";
import { calculateRetailPriceCents } from "@/lib/pricing";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const product = searchParams.get("product");

  try {
    if (!country && !product) {
      // Sadece ülke listesini getir
      const countries = await getCountries();
      return NextResponse.json({ success: true, countries });
    }

    // Fiyat ve stok listesi
    const prices = await getPrices({
      country: country || undefined,
      product: product || undefined,
    });

    // Fiyatları kâr marjlı perakende satış fiyatına dönüştür
    const catalog = prices
      .filter((p) => p.count > 0 && p.cost > 0)
      .map((p) => {
        const { retailPriceCents } = calculateRetailPriceCents(p.cost);
        return {
          country: p.country,
          product: p.product,
          operator: p.operator,
          count: p.count,
          rate: p.rate,
          retailPriceCents,
        };
      });

    return NextResponse.json({ success: true, catalog });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Katalog alınamadı" },
      { status: 500 }
    );
  }
}
