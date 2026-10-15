import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InvoicePilot | Expense desk",
  description: "Review invoice extractions and manage an expense ledger stored in your browser.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}