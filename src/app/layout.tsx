import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import WorkspaceShell from "@/components/WorkspaceShell";
import Providers from "@/components/Providers";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/constants";
import { normalizeLocale, translateServer } from "@/lib/i18n/server";
import "./globals.css";
import "@/game/three/lookbook.css";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://deskrpg.com";

async function getRequestLocale() {
  const cookieStore = await cookies();
  const headerStore = await headers();

  return normalizeLocale(
    cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? headerStore.get("accept-language"),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();

  return {
    metadataBase: new URL(BASE_URL),
    title: translateServer(locale, "metadata.title"),
    description: translateServer(locale, "metadata.description"),
    keywords: translateServer(locale, "metadata.keywords")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    authors: [{ name: "Dante Labs", url: "https://dante-labs.com" }],
    alternates: {
      canonical: "./",
      languages: {
        "en-US": "/?lang=en",
        "ko-KR": "/?lang=ko",
        "ja-JP": "/?lang=ja",
        "zh-CN": "/?lang=zh",
        "x-default": "/",
      },
    },
    openGraph: {
      title: "Rebeltransfer for Hermes",
      description: translateServer(locale, "metadata.openGraphDescription"),
      siteName: "Rebeltransfer for Hermes",
      url: BASE_URL,
      type: "website",
    },
    icons: {
      shortcut: "/favicon.ico",
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: "/apple-icon.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem("deskrpg_theme");
                if (theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
                  document.documentElement.classList.add("dark");
                  document.documentElement.setAttribute("data-theme", "dark");
                } else {
                  document.documentElement.classList.remove("dark");
                  document.documentElement.setAttribute("data-theme", "light");
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text transition-colors duration-150">
        <Providers initialLocale={locale}>
          <WorkspaceShell>{children}</WorkspaceShell>
        </Providers>
      </body>
    </html>
  );
}
