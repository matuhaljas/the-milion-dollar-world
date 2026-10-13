import { redirect } from "next/navigation";
import { db, stripe } from "@/lib/server";

// Stripe cancel_url: release the hold right away instead of after 30 minutes.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("order");
  const { data } = id
    ? await db().from("orders").select("stripe_session_id").eq("id", id).eq("status", "pending").maybeSingle()
    : { data: null };
  if (data?.stripe_session_id) {
    try {
      await stripe().checkout.sessions.expire(data.stripe_session_id); // fails if already paid → keep the order
      await db().from("orders").update({ status: "expired" }).eq("id", id!).eq("status", "pending");
    } catch {}
  }
  redirect("/");
}
