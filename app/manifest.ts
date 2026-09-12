import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lantern — Conversation intelligence",
    short_name: "Lantern",
    description:
      "Capture client conversations and approve the follow-ups that matter.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f3f8f4",
    theme_color: "#071a13",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
