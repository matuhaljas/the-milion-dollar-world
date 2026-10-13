import Link from "next/link";
import { loadPaidOrders } from "@/lib/server";
import { TOTAL, PRICE_CENTS } from "@/lib/grid";
import Globe from "./Globe";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  const [orders, { paid }] = await Promise.all([loadPaidOrders(), searchParams]);
  const sold = orders.reduce((n, o) => n + o.w * o.h, 0);

  return (
    <main style={{ position: "fixed", inset: 0 }}>
      <Globe orders={orders} paidId={paid ?? null} />
      <header style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "16px", pointerEvents: "none",
        background: "linear-gradient(#0b1020ee, #0b102000)" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px, 4vw, 30px)" }}>The Million Dollar Globe</h1>
        <p style={{ margin: "4px 0 0", maxWidth: 560, opacity: 0.85 }}>
          I&apos;m a uni student. Instead of working full-time next to my studies, I&apos;m selling the planet:{" "}
          <b>€{PRICE_CENTS / 100} per pixel</b>, yours forever. Zoom in, click a spot, leave your mark.
        </p>
        <p style={{ margin: "8px 0 0", fontVariantNumeric: "tabular-nums" }}>
          <b>{sold.toLocaleString("en")}</b> / {TOTAL.toLocaleString("en")} pixels sold ·{" "}
          <b>€{((sold * PRICE_CENTS) / 100).toLocaleString("en")}</b> raised
        </p>
      </header>
      <footer style={{ position: "absolute", bottom: 8, right: 16, fontSize: 13, opacity: 0.7 }}>
        <Link href="/terms">Terms &amp; contact</Link>
      </footer>
    </main>
  );
}
