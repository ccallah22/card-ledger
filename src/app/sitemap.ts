import type { MetadataRoute } from "next";

const BASE_URL = "https://thebinder.app";

const routes = [
  "/",
  "/demo",
  "/pricing",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/changelog",
  "/status",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: now,
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.6,
  }));
}
