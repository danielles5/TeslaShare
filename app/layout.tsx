import type { Metadata, Viewport } from "next";
import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/600.css";
import "@fontsource/nunito-sans/700.css";
import "@fontsource/nunito-sans/800.css";
import "./globals.css";
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const metadata: Metadata = {
  title: "Tesla Share",
  description: "A simpler way for Danielle and Maya to share charging costs.",
  manifest: `${base}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tesla Share",
  },
  icons: {
    icon: { url: `${base}/teslasharelogo.png`, type: "image/png", sizes: "1254x1254" },
    apple: { url: `${base}/teslasharelogo.png`, type: "image/png", sizes: "1254x1254" },
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f9f8",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
