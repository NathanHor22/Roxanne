import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Quipus",
  title: {
    default: "Quipus — Conversation intelligence",
    template: "%s · Quipus",
  },
  description:
    "Capture client conversations, remember what mattered, and approve every follow-up before it leaves your workspace.",
  category: "business",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#111916",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
