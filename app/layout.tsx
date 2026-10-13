import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Million Dollar Globe",
  description: "Own a pixel of the planet for €1 and help a student through university.",
};

const css = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #0b1020; color: #e8ecf3;
  font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
a { color: #ffd34d; }
button, input { font: inherit; }
button { cursor: pointer; border: 0; border-radius: 8px; padding: 10px 16px; background: #ffd34d; color: #1a1400; font-weight: 600; }
button:disabled { opacity: .5; cursor: not-allowed; }
button.ghost, .ghost-button { background: transparent; color: inherit; border: 1px solid #ffffff33; }
.ghost-button { display: inline-block; border-radius: 8px; padding: 10px 16px;
  font-weight: 600; cursor: pointer; opacity: 1; font-size: inherit; }
dialog { border: 0; border-radius: 14px; padding: 20px; width: min(380px, calc(100vw - 32px));
  background: #151b2e; color: inherit; box-shadow: 0 20px 60px #0008; }
dialog:focus-visible { outline: none; }
dialog::backdrop { background: #0006; }
label { display: block; margin: 10px 0 4px; font-size: 13px; opacity: .8; }
input:not([type=color]) { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #ffffff22; background: #0b1020; color: inherit; }
input[type=color] { width: 100%; height: 38px; border: 0; padding: 0; background: none; }
:focus-visible { outline: 2px solid #ffd34d; outline-offset: 2px; }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {children}
      </body>
    </html>
  );
}
