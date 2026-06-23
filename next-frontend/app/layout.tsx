import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";

import { SessionProvider } from "@/components/auth/session-provider";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StreamTube",
  description: "Video sharing platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", inter.variable, geistMono.variable, "font-sans")}
    >
      <body className="min-h-full flex flex-col font-sans">
        <SessionProvider
          initialSession={{
            userId: session.userId ?? "",
            email: session.email ?? "",
            channelSlug: session.channelSlug ?? "",
            isLoggedIn: session.isLoggedIn ?? false,
          }}
        >
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
