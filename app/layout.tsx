import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roxanne — Business memory",
  description: "You talk to people. Roxanne remembers what mattered.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
