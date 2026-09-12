import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Lantern",
  title: {
    default: "Lantern — Conversation intelligence",
    template: "%s · Lantern",
  },
  description:
    "Capture client conversations, remember what mattered, and approve every follow-up before it leaves your workspace.",
  category: "business",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#071a13",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
