import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Resale Radar",
    short_name: "Resale Radar",
    description: "Find overlooked value, verify it, and track real resale profit.",
    start_url: "/",
    display: "standalone",
    background_color: "#16171c",
    theme_color: "#16171c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Lets the Facebook or eBay app "Share" a listing straight into Resale Radar on Android.
    share_target: { action: "/import", method: "GET", params: { title: "title", text: "text", url: "url" } },
  } as MetadataRoute.Manifest;
}
