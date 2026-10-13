import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getOwnerIdOrNull } from "@/server/auth";
import { isLocalMode, withOwner, num } from "@/server/db";

// Every page reads per-owner data (the header shows unread alerts), so nothing is prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Resale Radar", template: "%s | Resale Radar" },
  description: "Resale intelligence: find overlooked value, verify it, calculate every cost, and track real profit.",
  applicationName: "Resale Radar",
  appleWebApp: { capable: true, title: "Resale Radar", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#16171c" },
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
  ],
};

const themeScript = `try{var t=localStorage.getItem('rr-theme');if(t==='light'){document.documentElement.classList.remove('dark')}}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ownerId = await getOwnerIdOrNull();
  let unread = 0;
  if (ownerId) {
    const [row] = await withOwner(ownerId, (q) => q.query<{ n: unknown }>(`select count(*) as n from alerts where read_at is null`));
    unread = num(row?.n);
  }
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell unread={unread} localMode={isLocalMode()}>
          {children}
        </AppShell>
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}` }} />
      </body>
    </html>
  );
}
