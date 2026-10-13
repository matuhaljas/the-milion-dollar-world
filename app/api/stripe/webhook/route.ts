import type Stripe from "stripe";
import { db, stripe } from "@/lib/server";

export async function POST(req: Request) {
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      await req.text(),
      req.headers.get("stripe-signature") ?? "",
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("Bad signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
    const session = event.data.object;
    const id = session.metadata?.order_id;
    if (!id) return new Response("ok");

    if (event.type === "checkout.session.expired") {
      await db().from("orders").update({ status: "expired" }).eq("id", id).eq("status", "pending");
    } else {
      // 'expired' too: a late webhook still counts if nobody took the spot meanwhile.
      const { error } = await db().from("orders").update({ status: "paid" }).eq("id", id).in("status", ["pending", "expired"]);
      if (error?.code === "23P01") {
        // Paid, but the spot was resold while the webhook was delayed: give the money back.
        await stripe().refunds.create({ payment_intent: session.payment_intent as string });
      } else if (error) {
        throw error; // 500 → Stripe retries
      }
    }
  }
  return new Response("ok");
}
