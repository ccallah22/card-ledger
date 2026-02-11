import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/cards/", "/account", "/admin", "/debug", "/login"],
      },
    ],
    sitemap: "https://thebinder.app/sitemap.xml",
  };
}
