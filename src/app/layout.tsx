import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Real Team Translation",
    template: "%s | Real Team Translation",
  },
  description:
    "Real-time transcription and translation tool for journalists. Capture audio, transcribe speech with speaker identification, and translate on-the-fly.",
  keywords: [
    "transcription",
    "translation",
    "real-time",
    "journalism",
    "speech-to-text",
    "Deepgram",
    "multilingual",
    "speaker diarization",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Real Team Translation",
    title: "Real Team Translation",
    description:
      "Real-time transcription and translation tool for journalists. Capture audio, transcribe speech, and translate on-the-fly.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Real Team Translation",
    description:
      "Real-time transcription and translation tool for journalists.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// JSON-LD structured data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Real Team Translation",
  description:
    "Real-time transcription and translation tool for journalists. Capture audio, transcribe speech with speaker identification, and translate on-the-fly.",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          <main id="main-content" className="flex-1">{children}</main>
          <SiteFooter />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
