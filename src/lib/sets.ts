export type SetEntry = {
  year: string;
  name: string;
  brand?: string;
  sport?: string;
  checklistKey?: "score-2025" | "donruss-2025" | "prizm-2025" | "prizm-cwc-2025";
};

// Confirmed 2025 / 2025-26 products only.
export const SET_LIBRARY: SetEntry[] = [
  // Football — 2025
  {
    year: "2025",
    name: "Panini Score",
    brand: "Panini",
    sport: "Football",
    checklistKey: "score-2025",
  },
  {
    year: "2025",
    name: "Panini Donruss",
    brand: "Panini",
    sport: "Football",
    checklistKey: "donruss-2025",
  },
  {
    year: "2025",
    name: "Panini Prizm",
    brand: "Panini",
    sport: "Football",
    checklistKey: "prizm-2025",
  },
  { year: "2025", name: "Panini Absolute", brand: "Panini", sport: "Football" },

  // Baseball — 2025
  { year: "2025", name: "Topps Chrome", brand: "Topps", sport: "Baseball" },
  { year: "2025", name: "Bowman", brand: "Topps", sport: "Baseball" },
  { year: "2025", name: "Bowman Chrome", brand: "Topps", sport: "Baseball" },
  { year: "2025", name: "Panini Prizm Baseball", brand: "Panini", sport: "Baseball" },
  { year: "2025", name: "Panini Prizm Premium Baseball", brand: "Panini", sport: "Baseball" },

  // Basketball — 2025-26
  { year: "2025-26", name: "Topps Chrome", brand: "Topps", sport: "Basketball" },

  // Soccer — 2025
  { year: "2025", name: "Topps Chrome MLS", brand: "Topps", sport: "Soccer" },
  {
    year: "2025",
    name: "Topps UEFA Club Competitions",
    brand: "Topps",
    sport: "Soccer",
  },
  {
    year: "2025",
    name: "Panini Prizm FIFA Club World Cup",
    brand: "Panini",
    sport: "Soccer",
    checklistKey: "prizm-cwc-2025",
  },

  // Hockey — 2025-26 (Seasonal releases)
  { year: "2025-26", name: "Upper Deck Allure", brand: "Upper Deck", sport: "Hockey" },
  {
    year: "2025-26",
    name: "Upper Deck Seasonal Releases",
    brand: "Upper Deck",
    sport: "Hockey",
  },
];
