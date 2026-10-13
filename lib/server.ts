import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { Order } from "./grid";

// Lazy so `next build` works without env vars.
export const db = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
export const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function loadPaidOrders(): Promise<Order[]> {
  if (!process.env.SUPABASE_URL) {
    console.warn("SUPABASE_URL not set, showing an empty globe");
    return [];
  }
  const orders: Order[] = [];
  // Supabase caps responses at 1000 rows, so page through.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("orders")
      .select("id,face,x,y,w,h,pixels,name,url")
      .eq("status", "paid")
      .order("created_at")
      .range(from, from + 999);
    if (error) throw error;
    orders.push(...data);
    if (data.length < 1000) return orders;
  }
}
