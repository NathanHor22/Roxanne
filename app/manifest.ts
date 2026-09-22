import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quipus — Conversation intelligence",
    short_name: "Quipus",
    description:
      "Capture client conversations and approve the follow-ups that matter.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#111916",
    theme_color: "#111916",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
