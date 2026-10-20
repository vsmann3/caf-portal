import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAF Portal",
  description: "Multi-tenant Customer Application Form portal for ISPs",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
