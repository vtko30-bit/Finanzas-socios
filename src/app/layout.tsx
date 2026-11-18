import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { OrgCapabilitiesProvider } from "@/components/org-capabilities-provider";
import { FinanzasShell } from "@/components/finanzas-shell";

export const metadata: Metadata = {
  title: "Finanzas Rg",
  description: "Control financiero multiusuario en la nube",
  applicationName: "Finanzas Rg",
  appleWebApp: {
    capable: true,
    title: "Finanzas Rg",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#e34584" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f6f5f2] font-sans text-stone-900">
        <AuthProvider>
          <OrgCapabilitiesProvider>
            <FinanzasShell>{children}</FinanzasShell>
          </OrgCapabilitiesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
