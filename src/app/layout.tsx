import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { OrgCapabilitiesProvider } from "@/components/org-capabilities-provider";
import { TopNav } from "@/components/top-nav";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full min-w-0 flex-col overflow-x-hidden bg-[#f4f7fd] font-sans text-slate-900">
        <AuthProvider>
          <OrgCapabilitiesProvider>
            <div className="flex min-h-full min-w-0 flex-1 flex-col">
              <TopNav />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </OrgCapabilitiesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
