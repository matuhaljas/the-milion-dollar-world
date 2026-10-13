"use server";
import { redirect } from "next/navigation";
import { db, stripe } from "@/lib/server";
import { PRICE_CENTS, cellToLatLon, validateBlock } from "@/lib/grid";

// Returns an error message for the dialog, or redirects to Stripe Checkout.
export async function createCheckout(_prev: string | null, form: FormData): Promise<string | null> {
  const block = { x: +form.get("x")!, y: +form.get("y")!, w: +form.get("w")!, h: +form.get("h")! };
  const color = String(form.get("color"));
  const name = String(form.get("name") ?? "").trim();
  const rawUrl = String(form.get("url") ?? "").trim();

  const blockError = validateBlock(block);
  if (blockError) return blockError;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "Pick a color";
  if (!name || name.length > 40) return "Name must be 1–40 characters";
  let url: string | null = null;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "https:" || rawUrl.length > 200) throw 0;
      url = u.href;
    } catch {
      return "Link must be a valid https:// URL (max 200 characters)";
    }
  }

  const supabase = db();
  // Free up holds from abandoned checkouts (no cron needed).
  await supabase.from("orders").update({ status: "expired" }).eq("status", "pending").lt("expires_at", new Date().toISOString());

  const { data: order, error } = await supabase
    .from("orders")
    .insert({ ...block, color, name, url })
    .select("id")
    .single();
  if (error?.code === "23P01") return "Someone just grabbed part of that spot, pick another one.";
  if (error) throw error;

  let checkoutUrl: string;
  try {
    const { lat, lon } = cellToLatLon(block.x, block.y);
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      allowed_payment_method_types: ["card", "link"], // instant only (no SEPA delays); Apple/Google Pay ride on card
      line_items: [{
        quantity: block.w * block.h,
        price_data: {
          currency: "eur",
          unit_amount: PRICE_CENTS,
          product_data: { name: `Globe pixel near ${lat.toFixed(1)}°, ${lon.toFixed(1)}°` },
        },
      }],
      metadata: { order_id: order.id },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // order hold is 35 min, always outlives this
      success_url: `${process.env.SITE_URL}/?paid=${order.id}`,
      cancel_url: `${process.env.SITE_URL}/api/cancel?order=${order.id}`,
    });
    await supabase.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);
    checkoutUrl = session.url!;
  } catch (e) {
    await supabase.from("orders").update({ status: "expired" }).eq("id", order.id);
    throw e;
  }
  redirect(checkoutUrl);
}
