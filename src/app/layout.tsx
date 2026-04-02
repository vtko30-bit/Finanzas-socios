import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OrgCapabilitiesProvider } from "@/components/org-capabilities-provider";
import { TopNav } from "@/components/top-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col text-slate-900">
        <OrgCapabilitiesProvider>
          <div className="relative flex min-h-full flex-1 flex-col">
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <div
                className="absolute left-1/2 top-1/2 h-[200vmin] w-[200vmin] -translate-x-1/2 -translate-y-1/2 rotate-90 bg-[url('/images/reportes-bg.png')] bg-cover bg-center bg-no-repeat"
                aria-hidden
              />
            </div>
            <div
              className="pointer-events-none absolute inset-0 bg-sky-100/45"
              aria-hidden
            />
            <div className="relative z-10 flex min-h-full flex-1 flex-col">
              <TopNav />
              {children}
            </div>
          </div>
        </OrgCapabilitiesProvider>
      </body>
    </html>
  );
}
