import { NextResponse } from "next/server";
import { checkOrderAction } from "@/app/actions/order";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing order id" }, { status: 400 });
  }

  const result = await checkOrderAction(id);
  return NextResponse.json(result);
}
