import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Brandmaster — Brand Validation Portal",
  description: "Local-first automotive brand validation and import workspace",
  applicationName: "Brandmaster",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/brandmaster-logo.jpeg`,
    apple: `${basePath}/brandmaster-logo.jpeg`,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#3665f3" },
    { media: "(prefers-color-scheme: dark)", color: "#111316" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
