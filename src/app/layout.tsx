import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { OrgCapabilitiesProvider } from "@/components/org-capabilities-provider";
import { FinanzasShell } from "@/components/finanzas-shell";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Finanzas Rg",
  description: "Control financiero multiusuario en la nube",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${dmSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
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
