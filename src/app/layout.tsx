import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const display = localFont({
  variable: "--font-display",
  src: [
    {
      path: "../../font/Harmond - Free For Personal Use/Harmond-SemiBoldCondensed.otf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../font/Harmond - Free For Personal Use/Harmond-SemBdItaCond.otf",
      weight: "600",
      style: "italic",
    },
  ],
});

const mono = localFont({
  variable: "--font-copy",
  src: [
    { path: "../../font/DXRigraf-SemiBold.otf", weight: "600", style: "normal" },
    {
      path: "../../font/DXRigraf-SemiBoldItalic.otf",
      weight: "600",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
  title: "The Fantasy Ring Collection",
  description: "A cinematic single-page ring collection experience forged in darkness.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
