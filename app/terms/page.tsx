// TODO before going live: fill in your name, country and contact email (Stripe requires these).
export default function Terms() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "32px 16px" }}>
      <h1>Terms &amp; contact</h1>
      <p><b>Operator:</b> [Your name], [Country]. <b>Contact:</b> [your email]</p>
      <h2>What you buy</h2>
      <p>
        A purchase places your chosen color, name and link on a block of cells on the globe at this site, for as long
        as the site runs. Each cell costs €1, minimum 10 cells. Payments are processed by Stripe. The money
        funds my university studies.
      </p>
      <h2>Refunds</h2>
      <p>
        Pixels are a digital contribution that is delivered immediately, so purchases are non-refundable. If your
        pixels don&apos;t appear after payment, email me and I&apos;ll fix it or refund you in full.
      </p>
      <h2>Content rules</h2>
      <p>
        No illegal, hateful, sexual, or malicious content or links (malware, phishing, scams). I may hide pixels or remove
        links that break these rules, without a refund.
      </p>
      <p><a href="/">← Back to the globe</a></p>
    </main>
  );
}
