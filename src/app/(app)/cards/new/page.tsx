"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { SportsCard, CardCondition, CardStatus } from "@/lib/types";
import { loadCards, upsertCard } from "@/lib/storage";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { getSharedImage, saveSharedImage } from "@/lib/sharedImages";
import { IMAGE_RULES, cropImageDataUrl, processImageFile, rotateImageDataUrl } from "@/lib/image";
import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";
import { SET_LIBRARY } from "@/lib/sets";
import { SCORE_2025_CHECKLIST, type ChecklistEntry } from "@/lib/checklists/score2025";
import { SCORE_2025_AUTOGRAPHS } from "@/lib/checklists/score2025_autographs";
import { SCORE_2025_MEMORABILIA } from "@/lib/checklists/score2025_memorabilia";
import { SCORE_2025_INSERTS } from "@/lib/checklists/score2025_inserts";
import { DONRUSS_2025_CHECKLIST } from "@/lib/checklists/donruss2025";
import { DONRUSS_2025_AUTOGRAPHS } from "@/lib/checklists/donruss2025_autographs";
import { DONRUSS_2025_MEMORABILIA } from "@/lib/checklists/donruss2025_memorabilia";
import { DONRUSS_2025_INSERTS } from "@/lib/checklists/donruss2025_inserts";
import { PRIZM_2025_CHECKLIST } from "@/lib/checklists/prizm2025";
import { PRIZM_2025_AUTOGRAPHS } from "@/lib/checklists/prizm2025_autographs";
import { PRIZM_2025_MEMORABILIA } from "@/lib/checklists/prizm2025_memorabilia";
import { PRIZM_2025_INSERTS } from "@/lib/checklists/prizm2025_inserts";
import { PRIZM_2025_FIFA_CLUB_WORLD_CUP_CHECKLIST } from "@/lib/checklists/prizm2025_fifa_club_world_cup";

const INSERT_SECTIONS = new Set([
  "Anniversary Rookies",
  "Celebration",
  "Emerged",
  "First Ballot",
  "Hot Rookies",
  "Intergalactic",
  "League Leaders",
  "Men of Canton",
  "NFL Draft",
  "Sack Attack",
  "Showtime",
  "Step Ahead",
  "The Franchise",
  "Throwbacks",
  "Top 100",
  "Action All-Pros",
  "All-Time Gridiron Kings",
  "Best of Instant",
  "Bomb Squad",
  "Champ is Here",
  "Champions",
  "Crunch Time",
  "Dominators",
  "Downtown!",
  "Horizontal Downtown!",
  "Galaxy of Stars",
  "Gridiron Kings",
  "Gridiron Marvels",
  "Inducted",
  "Optic Rated Rookies Preview Holo",
  "Production Line",
  "Rated Rookies Retro",
  "Rated Rookies Throwback",
  "Red Hot Rookies",
  "Retro 1995",
  "Retro 2005",
  "Road to the Super Bowl Wild Card",
  "Road to the Super Bowl Divisional Round",
  "Road to the Super Bowl Conference Championship",
  "Road to the Super Bowl Championship",
  "Rookie Gridiron Kings",
  "Rookie Revolution",
  "Super Bowl MVP",
  "The Elite Series",
  "The Elite Series Rookies",
  "The Legends Series",
  "The Rookies",
  "Unleashed",
  "Vortex",
  "White Hot Rookies",
  "All Purpose Prizms Silver",
  "Color Blast",
  "Color Blast Duals",
  "Emergent",
  "Fireworks",
  "Fractal",
  "Global Reach",
  "Lockdown! Prizms Silver",
  "Manga - Horizontal",
  "Manga - Vertical",
  "Prizm Break",
  "Prizm Flashback Prizms Silver",
  "Prizm Flashback Rookie Prizms Silver",
  "Prizmania",
  "Prizmatic",
  "Continental Contenders",
  "Continental Pride",
  "En Fuego",
  "Global Graphs",
  "Inter-Continental",
  "Kaboom!",
  "Legendary Talents",
  "New Era",
  "Pitch Crowns",
  "Team Badges",
  "The Logo",
  "The Trophy",
  "Widescreen",
]);

const VARIANT_KEYWORDS = [
  "Gold",
  "Green",
  "Orange",
  "Pink",
  "Purple",
  "Red",
  "Silver",
  "Black",
  "White",
  "Prizm",
  "Mojo",
  "Pink Wave",
  "Green Wave",
  "No Huddle",
  "Sparkle",
  "Shimmer",
  "Disco",
  "Checker",
  "Tiger Stripe",
  "Wave",
  "Pulsar",
  "Camo",
  "Vinyl",
  "Ice",
  "Neon Green",
  "Aqueous Test",
  "Canvas",
  "No Name",
  "Press Proofs",
  "Season Stat Line",
  "Jersey Number",
  "Pumpkin",
  "Scorecard",
  "Extraterrestrial",
  "Lava",
  "Dots Gold",
  "Stars",
  "Spokes",
  "Bats",
  "Dots Blue",
  "Ellipse",
  "Circular",
  "Showcase",
  "Cubic",
  "Electric",
  "Trick or Treat",
  "Gold Zone",
  "Artist's Proof",
  "Webs",
  "Dots Red",
  "Red Zone",
  "Die-Cut",
  "First Down",
  "End Zone",
  "Gem Masters",
  "Printing Plates",
  "Prime",
  "Super Prime",
  "Ground Zero",
  "Studio Series",
  "Laundry Tag",
  "NFL Shield",
  "Holo",
  "Galactic",
  "Cosmic",
  "Football Emoji",
  "Green Velocity",
  "Red and Green",
  "Red Pandora",
  "Red Power",
  "Blue Scope",
  "Green Pandora",
  "Gold Ice",
  "Rookie Dynamics",
];

const VARIANT_LIST = [
  { label: "Prizm Black and Blue Checker" },
  { label: "Prizm Black and Red Checker" },
  { label: "Prizm Black and White Checker" },
  { label: "Prizm Blue" },
  { label: "Prizm Choice Blue Yellow and Green" },
  { label: "Prizm Choice Tiger Stripe" },
  { label: "Prizm Green Flash" },
  { label: "Prizm Green Ice" },
  { label: "Prizm Green Wave" },
  { label: "Prizm Lazer" },
  { label: "Prizm Neon Green Pulsar" },
  { label: "Prizm No Huddle" },
  { label: "Prizm Orange Ice" },
  { label: "Prizm Pink" },
  { label: "Prizm Pink Wave" },
  { label: "Prizm Press Proof" },
  { label: "Prizm Purple Pulsar" },
  { label: "Prizm Red" },
  { label: "Prizm Red Flash" },
  { label: "Prizm Red Sparkle" },
  { label: "Prizm Red White and Blue" },
  { label: "Prizm Silver" },
  { label: "Prizm Snakeskin" },
  { label: "Prizm White Disco" },
  { label: "Prizm White Sparkle" },
  { label: "Prizm Pandora /400", total: "400" },
  { label: "Prizm Orange /249", total: "249" },
  { label: "Prizm Blue Wave /230", total: "230" },
  { label: "Prizm Purple Ice /225", total: "225" },
  { label: "Prizm Hyper /200", total: "200" },
  { label: "Prizm Pigskin /180", total: "180" },
  { label: "Prizm Red Wave /149", total: "149" },
  { label: "Prizm No Huddle Blue /125", total: "125" },
  { label: "Prizm Purple /125", total: "125" },
  { label: "Prizm Blue Ice /99", total: "99" },
  { label: "Prizm No Huddle Red /99", total: "99" },
  { label: "Prizm Purple Wave /99", total: "99" },
  { label: "Prizm Blue Sparkle /96", total: "96" },
  { label: "Prizm Green Scope /75", total: "75" },
  { label: "Prizm No Huddle Purple /75", total: "75" },
  { label: "Prizm Orange Wave /65", total: "65" },
  { label: "Prizm Kangaroo /61", total: "61" },
  { label: "Prizm Super Bowl LX /60", total: "60" },
  { label: "Prizm Purple Power /49", total: "49" },
  { label: "Prizm Red Shimmer /49", total: "49" },
  { label: "Prizm Red and Yellow /44", total: "44" },
  { label: "Prizm Blue Shimmer /35", total: "35" },
  { label: "Prizm White /35", total: "35" },
  { label: "Prizm Navy Camo /25", total: "25" },
  { label: "Prizm No Huddle Pink /25", total: "25" },
  { label: "Prizm Gold Sparkle /24", total: "24" },
  { label: "Prizm Choice Red /20", total: "20" },
  { label: "Prizm Panini Logo /20", total: "20" },
  { label: "Prizm Lotus Flower /18", total: "18" },
  { label: "Prizm Choice Cherry Blossom /15", total: "15" },
  { label: "Prizm Forest Camo /15", total: "15" },
  { label: "Prizm Purple Shimmer /15", total: "15" },
  { label: "Prizm Choice Blue /14", total: "14" },
  { label: "Prizm Choice Gold /10", total: "10" },
  { label: "Prizm Gold /10", total: "10" },
  { label: "Prizm Gold Shimmer /10", total: "10" },
  { label: "Prizm Gold Wave /10", total: "10" },
  { label: "Prizm No Huddle Neon Green /10", total: "10" },
  { label: "Prizm No Huddle Gold /10", total: "10" },
  { label: "Prizm No Huddle Black /1", total: "1" },
  { label: "Prizm Camo /25", total: "25" },
  { label: "Prizm Green Sparkle /8", total: "8" },
  { label: "Prizm Plum Blossom /8", total: "8" },
  { label: "Prizm Gold Vinyl /5", total: "5" },
  { label: "Prizm Green Shimmer /5", total: "5" },
  { label: "Prizm White Knight /3", total: "3" },
  { label: "Prizm Black Finite /1", total: "1" },
  { label: "Prizm Black Shimmer /1", total: "1" },
  { label: "Prizm Black Stars /1", total: "1" },
  { label: "Prizm Choice Nebula /1", total: "1" },
  { label: "Green Wave" },
  { label: "No Huddle" },
  { label: "Pink Wave" },
  { label: "Mojo /25", total: "25" },
  { label: "Red Shimmer /35", total: "35" },
  { label: "Blue Shimmer /25", total: "25" },
  { label: "Green Shimmer /5", total: "5" },
  { label: "Black Shimmer /1", total: "1" },
  { label: "Blue Ice /99", total: "99" },
  { label: "Navy Camo /25", total: "25" },
  { label: "Neon Green Pulsar" },
  { label: "Pink" },
  { label: "Purple Pulsar" },
  { label: "Aqueous Test" },
  { label: "Canvas" },
  { label: "No Name" },
  { label: "Extraterrestrial" },
  { label: "Gold" },
  { label: "Green" },
  { label: "Orange" },
  { label: "Pink" },
  { label: "Purple" },
  { label: "Red" },
  { label: "Silver" },
  { label: "Black" },
  { label: "White" },
  { label: "Pumpkin" },
  { label: "Scorecard" },
  { label: "Rookie Dynamics" },
  { label: "Lava /799", total: "799" },
  { label: "Dots Gold /499", total: "499" },
  { label: "Stars /499", total: "499" },
  { label: "Spokes /415", total: "415" },
  { label: "Bats /399", total: "399" },
  { label: "Dots Blue /399", total: "399" },
  { label: "Ellipse /399", total: "399" },
  { label: "Circular /299", total: "299" },
  { label: "Showcase /100", total: "100" },
  { label: "Showcase /250", total: "250" },
  { label: "Cubic /185", total: "185" },
  { label: "Electric /99", total: "99" },
  { label: "Trick or Treat /99", total: "99" },
  { label: "Press Proofs Blue" },
  { label: "Press Proofs Green" },
  { label: "Press Proofs Purple" },
  { label: "Press Proofs Red" },
  { label: "Press Proofs Yellow" },
  { label: "Press Proofs Silver /199", total: "199" },
  { label: "Press Proofs Silver Die-Cut /99", total: "99" },
  { label: "Press Proofs Gold /50", total: "50" },
  { label: "Press Proofs Gold Die-Cut /25", total: "25" },
  { label: "Press Proofs Black /10", total: "10" },
  { label: "Press Proofs Black Die-Cut /1", total: "1" },
  { label: "Prime /100", total: "100" },
  { label: "Prime /49", total: "49" },
  { label: "Prime /25", total: "25" },
  { label: "Ground Zero /25", total: "25" },
  { label: "Studio Series /100", total: "100" },
  { label: "Gold Zone /50", total: "50" },
  { label: "Artist's Proof /35", total: "35" },
  { label: "Webs /31", total: "31" },
  { label: "Dots Red /25", total: "25" },
  { label: "Red Zone /20", total: "20" },
  { label: "Die-Cut /10", total: "10" },
  { label: "First Down /10", total: "10" },
  { label: "End Zone /6", total: "6" },
  { label: "Gem Masters /1", total: "1" },
  { label: "Super Prime /1", total: "1" },
  { label: "Holo /100", total: "100" },
  { label: "Gold /10", total: "10" },
  { label: "Black /1", total: "1" },
  { label: "Galactic" },
  { label: "Cosmic /100", total: "100" },
  { label: "Cubic /50", total: "50" },
  { label: "Lava /10", total: "10" },
  { label: "Football Emoji" },
  { label: "Green Velocity" },
  { label: "Red and Green" },
  { label: "Red Pandora" },
  { label: "Red Power" },
  { label: "Blue Scope /100", total: "100" },
  { label: "Purple /50", total: "50" },
  { label: "Green Pandora /25", total: "25" },
  { label: "Gold Ice /10", total: "10" },
  { label: "Laundry Tag Brand Logo /1", total: "1" },
  { label: "Laundry Tag NFL Players /1", total: "1" },
  { label: "Laundry Tag NFL Shield /1", total: "1" },
  { label: "Laundry Tag Player's Logo /1", total: "1" },
  { label: "NFL Shield /1", total: "1" },
  { label: "Printing Plates Black /1", total: "1" },
  { label: "Printing Plates Cyan /1", total: "1" },
  { label: "Printing Plates Magenta /1", total: "1" },
  { label: "Printing Plates Yellow /1", total: "1" },
];

const SCORE_BASE_VARIANTS = [
  "Extraterrestrial",
  "Gold",
  "Green",
  "Orange",
  "Pumpkin",
  "Purple",
  "Red",
  "Scorecard",
  "Lava /799",
  "Dots Gold /499",
  "Stars /499",
  "Spokes /415",
  "Bats /399",
  "Dots Blue /399",
  "Ellipse /399",
  "Circular /299",
  "Showcase /250",
  "Cubic /185",
  "Electric /99",
  "Trick or Treat /99",
  "Gold Zone /50",
  "Artist's Proof /35",
  "Webs /31",
  "Dots Red /25",
  "Red Zone /20",
  "Die-Cut /10",
  "First Down /10",
  "End Zone /6",
  "Gem Masters /1",
  "Printing Plates Black /1",
  "Printing Plates Cyan /1",
  "Printing Plates Magenta /1",
  "Printing Plates Yellow /1",
];

const SCORE_INSERT_VARIANTS_FULL = [
  "Rookie Dynamics",
  "Gold",
  "Orange",
  "Pink",
  "Purple",
  "Red",
  "Showcase /100",
  "Gold Zone /50",
  "Artist's Proof /35",
  "Red Zone /20",
  "First Down /10",
  "End Zone /6",
  "Gem Masters /1",
];

const SCORE_INSERT_VARIANTS_STANDARD = SCORE_INSERT_VARIANTS_FULL.filter(
  (v) => v !== "Rookie Dynamics"
);

const SCORE_INSERT_VARIANTS_SHORT = [
  "Showcase /100",
  "Gold Zone /50",
  "Artist's Proof /35",
  "Red Zone /20",
  "First Down /10",
  "End Zone /6",
  "Gem Masters /1",
];

const SCORE_SECTION_VARIANTS: Record<string, string[]> = {
  Base: SCORE_BASE_VARIANTS,
  Rookies: SCORE_BASE_VARIANTS,
  "Mystery Rookie Redemption": ["First Down /10", "Gem Masters /1"],
  "Stars of the NFL Jerseys": ["Prime /100", "Super Prime /1"],
  "Zoned In Jerseys": ["Prime /100", "Super Prime /1"],
  "Double Trouble": ["Ground Zero /25"],
  "It's Good! Graphs": ["Ground Zero /25"],
  "Next Era NIL Autographs": ["Ground Zero /25"],
  "Anniversary Rookies": SCORE_INSERT_VARIANTS_FULL,
  Celebration: SCORE_INSERT_VARIANTS_STANDARD,
  Emerged: SCORE_INSERT_VARIANTS_SHORT,
  "First Ballot": SCORE_INSERT_VARIANTS_STANDARD,
  "Hot Rookies": SCORE_INSERT_VARIANTS_STANDARD,
  Intergalactic: [],
  "League Leaders": SCORE_INSERT_VARIANTS_STANDARD,
  "Men of Canton": SCORE_INSERT_VARIANTS_STANDARD,
  "NFL Draft": SCORE_INSERT_VARIANTS_STANDARD,
  "Sack Attack": SCORE_INSERT_VARIANTS_STANDARD,
  Showtime: [],
  "Step Ahead": [],
  "The Franchise": SCORE_INSERT_VARIANTS_STANDARD,
  Throwbacks: SCORE_INSERT_VARIANTS_STANDARD,
  "Top 100": [],
};

const PRIZM_BASE_VARIANTS = [
  "Prizm Black and Blue Checker",
  "Prizm Black and Red Checker",
  "Prizm Black and White Checker",
  "Prizm Blue",
  "Prizm Choice Blue Yellow and Green",
  "Prizm Choice Tiger Stripe",
  "Prizm Green Flash",
  "Prizm Green Ice",
  "Prizm Green Wave",
  "Prizm Lazer",
  "Prizm Neon Green Pulsar",
  "Prizm No Huddle",
  "Prizm Orange Ice",
  "Prizm Pink",
  "Prizm Pink Wave",
  "Prizm Press Proof",
  "Prizm Purple Pulsar",
  "Prizm Red",
  "Prizm Red Flash",
  "Prizm Red Sparkle",
  "Prizm Red White and Blue",
  "Prizm Silver",
  "Prizm Snakeskin",
  "Prizm White Disco",
  "Prizm White Sparkle",
  "Prizm Pandora /400",
  "Prizm Orange /249",
  "Prizm Blue Wave /230",
  "Prizm Purple Ice /225",
  "Prizm Hyper /200",
  "Prizm Pigskin /180",
  "Prizm Red Wave /149",
  "Prizm No Huddle Blue /125",
  "Prizm Purple /125",
  "Prizm Blue Ice /99",
  "Prizm No Huddle Red /99",
  "Prizm Purple Wave /99",
  "Prizm Blue Sparkle /96",
  "Prizm Green Scope /75",
  "Prizm No Huddle Purple /75",
  "Prizm Orange Wave /65",
  "Prizm Kangaroo /61",
  "Prizm Super Bowl LX /60",
  "Prizm Purple Power /49",
  "Prizm Red Shimmer /49",
  "Prizm Red and Yellow /44",
  "Prizm Blue Shimmer /35",
  "Prizm White /35",
  "Prizm Navy Camo /25",
  "Prizm No Huddle Pink /25",
  "Prizm Gold Sparkle /24",
  "Prizm Choice Red /20",
  "Prizm Panini Logo /20",
  "Prizm Lotus Flower /18",
  "Prizm Choice Cherry Blossom /15",
  "Prizm Forest Camo /15",
  "Prizm Purple Shimmer /15",
  "Prizm Choice Blue /14",
  "Prizm Choice Gold /10",
  "Prizm Gold /10",
  "Prizm Gold Shimmer /10",
  "Prizm Gold Wave /10",
  "Prizm No Huddle Neon Green /10",
  "Prizm Green Sparkle /8",
  "Prizm Plum Blossom /8",
  "Prizm Gold Vinyl /5",
  "Prizm Green Shimmer /5",
  "Prizm White Knight /3",
  "Prizm Black Finite /1",
  "Prizm Black Shimmer /1",
  "Prizm Black Stars /1",
  "Prizm Choice Nebula /1",
];

const PRIZM_INSERT_VARIANTS_LONG = [
  "Green",
  "Green Ice",
  "Green Wave",
  "No Huddle",
  "Silver",
  "Blue Ice /99",
  "Purple Power /49",
  "Gold /10",
  "Gold Vinyl /5",
  "Black Finite /1",
];

const PRIZM_INSERT_VARIANTS_SHORT = ["No Huddle", "Mojo /25", "Gold /10", "Black Finite /1"];

const PRIZM_MEMO_VARIANTS = ["Neon Green Pulsar", "Pink", "Purple Pulsar"];

const PRIZM_BASE_AUTOGRAPH_VARIANTS = [
  "Silver",
  "Red Shimmer /35",
  "Blue Shimmer /25",
  "Green Shimmer /5",
  "Black Shimmer /1",
];

const PRIZM_ROOKIE_AUTOGRAPH_VARIANTS = [
  "Prizm No Huddle",
  "Prizm Pink",
  "Prizm Purple Pulsar",
  "Prizm Red Wave /149",
  "Prizm Green Scope /75",
  "Prizm Purple Power /49",
  "Prizm Red Shimmer /35",
  "Prizm Blue Shimmer /25",
  "Prizm Camo /25",
  "Prizm Gold /10",
  "Prizm No Huddle Gold /10",
  "Prizm Gold Vinyl /5",
  "Prizm Green Shimmer /5",
  "Prizm Black Finite /1",
  "Prizm Black Shimmer /1",
  "Prizm No Huddle Black /1",
  "Prizm White Sparkle /1",
];

const PRIZM_SECTION_VARIANTS: Record<string, string[]> = {
  "Base Set Checklist": PRIZM_BASE_VARIANTS,
  "Base - Rookies": PRIZM_BASE_VARIANTS,
  "Rookie Variations Prizms Silver": [
    "Green Wave",
    "No Huddle",
    "Pink Wave",
    "Mojo /25",
    "Gold /10",
    "Black Finite /1",
  ],
  "Base Autographs": PRIZM_BASE_AUTOGRAPH_VARIANTS,
  "Base - Rookie Autographs Silver Prizm": PRIZM_ROOKIE_AUTOGRAPH_VARIANTS,
  "All Purpose Prizms Silver": PRIZM_INSERT_VARIANTS_SHORT,
  "Color Blast": [],
  "Color Blast Duals": [],
  Emergent: PRIZM_INSERT_VARIANTS_LONG,
  Fireworks: PRIZM_INSERT_VARIANTS_LONG,
  Fractal: PRIZM_INSERT_VARIANTS_LONG,
  "Global Reach": PRIZM_INSERT_VARIANTS_LONG,
  "Lockdown! Prizms Silver": PRIZM_INSERT_VARIANTS_SHORT,
  "Manga - Horizontal": [],
  "Manga - Vertical": [],
  "Prizm Break": PRIZM_INSERT_VARIANTS_LONG,
  "Prizm Flashback Prizms Silver": PRIZM_INSERT_VARIANTS_SHORT,
  "Prizm Flashback Rookie Prizms Silver": PRIZM_INSERT_VARIANTS_SHORT,
  Prizmania: [],
  Prizmatic: PRIZM_INSERT_VARIANTS_LONG,
  "Premier Jerseys": PRIZM_MEMO_VARIANTS,
  "Rookie Gear": PRIZM_MEMO_VARIANTS,
};

const CWC_BASE_VARIANTS = [
  "Glitter Prizms",
  "Green Ice Prizms",
  "Hyper Prizms",
  "Ice Prizms",
  "Pandora Prizms",
  "Pulsar Prizms",
  "Red, White, and Blue Mojo Prizms",
  "Seismic Prizms",
  "Silver Prizms",
  "White Knight Prizms",
  "White Sparkle Prizms",
  "Pink Seismic Prizms /299",
  "Red Pulsar Prizms /299",
  "Blue Pulsar Prizms /275",
  "Blue Seismic Prizms /275",
  "Orange Seismic Prizms /199",
  "Red Prizms /199",
  "Blue Ice Prizms /175",
  "Blue Glitter Prizms /149",
  "Orange Pulsar Prizms /149",
  "Purple Glitter Prizms /125",
  "Purple Prizms /125",
  "Orange Glitter Prizms /99",
  "Purple Seismic Prizms /99",
  "Teal Prizms /99",
  "Purple Pulsar Prizms /75",
  "Purple Pandora Prizms /49",
  "Teal Seismic Prizms /49",
  "Multicolor Mojo Prizms /25",
  "Teal Pulsar Prizms /25",
  "Logo Prizms /20",
  "Pink Mojo Prizms /11",
  "Gold Glitter Prizms /10",
  "Gold Prizms /10",
  "Gold Pulsar Prizms /10",
  "Gold Seismic Prizms /10",
  "Blue Shimmer Prizms /8",
  "Green Prizms /5",
  "Gold Shimmer Prizms /3",
  "Gold Vinyl Prizms /1",
];

const CWC_INSERT_VARIANTS = [
  "Silver Prizms",
  "Blue Ice Prizms /99",
  "Purple Pandora Prizms /49",
  "Mojo Prizms /25",
  "Gold Prizms /10",
  "Green Prizms /5",
  "Gold Vinyl Prizms /1",
];

const CWC_SECTION_VARIANTS: Record<string, string[]> = {
  "Base Set": CWC_BASE_VARIANTS,
  "Continental Contenders": CWC_INSERT_VARIANTS,
  "En Fuego": CWC_INSERT_VARIANTS,
  "Inter-Continental": CWC_INSERT_VARIANTS,
  "Kaboom!": ["Gold /10", "Green /1"],
  "Legendary Talents": CWC_INSERT_VARIANTS,
  "New Era": CWC_INSERT_VARIANTS,
  "Prizmania": CWC_INSERT_VARIANTS,
  "Team Badges": CWC_INSERT_VARIANTS,
  "Widescreen": CWC_INSERT_VARIANTS,
};

const DONRUSS_BASE_VARIANTS = [
  "Aqueous Test",
  "Canvas",
  "No Name",
  "Press Proofs Blue",
  "Press Proofs Green",
  "Press Proofs Purple",
  "Press Proofs Red",
  "Press Proofs Yellow",
  "Press Proofs Silver /199",
  "Press Proofs Silver Die-Cut /99",
  "Press Proofs Gold /50",
  "Press Proofs Gold Die-Cut /25",
  "Press Proofs Black /10",
  "Press Proofs Black Die-Cut /1",
];

const DONRUSS_GOLD_BLACK = ["Gold /10", "Black /1"];
const DONRUSS_HOLO = ["Holo /100"];
const DONRUSS_GALAXY_VARIANTS = ["Galactic", "Cosmic /100", "Cubic /50", "Lava /10"];
const DONRUSS_STUDIO_SERIES = ["Studio Series /100"];

const DONRUSS_OPTIC_PREVIEW_VARIANTS = [
  "Football Emoji",
  "Green Velocity",
  "Pink",
  "Red and Green",
  "Red Pandora",
  "Red Power",
  "Blue Scope /100",
  "Purple /50",
  "Green Pandora /25",
  "Gold Ice /10",
];

const DONRUSS_THREADS_VARIANTS = [
  "Prime /25",
  "Laundry Tag Brand Logo /1",
  "Laundry Tag NFL Players /1",
  "Laundry Tag NFL Shield /1",
];

const DONRUSS_ROOKIE_PHENOM_VARIANTS = [
  "Prime /49",
  "Laundry Tag Brand Logo /1",
  "Laundry Tag Player's Logo /1",
  "Laundry Tag NFL Shield /1",
];

const DONRUSS_SIGNATURE_VARIANTS = [
  "Blue /50",
  "Green /25",
  "Purple /10",
  "Red /5",
  "Black /1",
];

const DONRUSS_SECTION_VARIANTS: Record<string, string[]> = {
  Base: DONRUSS_BASE_VARIANTS,
  "Base - Rated Rookies": DONRUSS_BASE_VARIANTS,
  "Best of Instant": DONRUSS_HOLO,
  "Bomb Squad": DONRUSS_HOLO,
  "Champ is Here": DONRUSS_HOLO,
  Champions: DONRUSS_HOLO,
  "Crunch Time": DONRUSS_GOLD_BLACK,
  "Downtown!": DONRUSS_GOLD_BLACK,
  "Horizontal Downtown!": DONRUSS_GOLD_BLACK,
  "Galaxy of Stars": DONRUSS_GALAXY_VARIANTS,
  "Gridiron Kings": DONRUSS_STUDIO_SERIES,
  "Gridiron Marvels": DONRUSS_GOLD_BLACK,
  Inducted: DONRUSS_HOLO,
  "Optic Rated Rookies Preview Holo": DONRUSS_OPTIC_PREVIEW_VARIANTS,
  "Production Line": DONRUSS_GALAXY_VARIANTS,
  "Rated Rookies Throwback": DONRUSS_STUDIO_SERIES,
  "Rookie Gridiron Kings": DONRUSS_STUDIO_SERIES,
  "Rookie Revolution": DONRUSS_GALAXY_VARIANTS,
  "Road to the Super Bowl Wild Card": DONRUSS_HOLO,
  "Road to the Super Bowl Divisional Round": DONRUSS_HOLO,
  "Road to the Super Bowl Conference Championship": DONRUSS_HOLO,
  "Road to the Super Bowl Championship": DONRUSS_HOLO,
  "Super Bowl MVP": DONRUSS_HOLO,
  Unleashed: DONRUSS_GOLD_BLACK,
  Vortex: DONRUSS_GALAXY_VARIANTS,
  "All Pro Kings": DONRUSS_STUDIO_SERIES,
  "Canton Kings": DONRUSS_STUDIO_SERIES,
  "Donruss Threads": DONRUSS_THREADS_VARIANTS,
  "Jersey Kings": DONRUSS_STUDIO_SERIES,
  "Leather Kings": DONRUSS_STUDIO_SERIES,
  "Passing the Torch Jerseys": ["Prime /49"],
  "Rookie Holiday Sweater": ["NFL Shield /1"],
  "Rookie Holiday Sweater Dual": ["NFL Shield /1"],
  "Rookie Phenom Jerseys": DONRUSS_ROOKIE_PHENOM_VARIANTS,
  "Signature Marks": DONRUSS_SIGNATURE_VARIANTS,
  "Signature Series": DONRUSS_SIGNATURE_VARIANTS,
  "Rookie Phenom Jersey Autographs": DONRUSS_ROOKIE_PHENOM_VARIANTS,
};

const DONRUSS_EXCLUDED_SECTION_PREFIXES = ["Action All-Pros", "Action All-Pros Autographs"];

const DONRUSS_EXCLUSIONS: Record<
  string,
  { noBase?: boolean; noVariants?: string[]; onlyVariants?: string[] }
> = {
  "Rookie Phenom Jersey Autographs#1": { noBase: true, noVariants: ["Prime /49"] },
  // Signature Marks
  "Signature Marks#3": { noBase: true },
  "Signature Marks#14": { noBase: true },
  "Signature Marks#18": { noBase: true },
  "Signature Marks#20": { noBase: true },
  "Signature Marks#23": { noBase: true },
  "Signature Marks#27": { noBase: true, noVariants: ["Blue /50"] },
  "Signature Marks#31": { noVariants: ["Blue /50", "Green /25"] },
  "Signature Marks#48": { noBase: true },
  // Signature Series
  "Signature Series#20": { noBase: true, onlyVariants: ["Black /1"] },
  "Signature Series#22": { noBase: true },
  "Signature Series#26": { noBase: true },
  "Signature Series#30": { noBase: true },
  "Signature Series#32": { noBase: true },
  "Signature Series#49": { noBase: true },
  "Signature Series#50": { noBase: true },
};

const PRIZM_SKIP_BASE_SECTIONS = new Set<string>();

const PRIZM_EXCLUSIONS: Record<
  string,
  { noBase?: boolean; noVariants?: string[]; onlyVariants?: string[] }
> = {
  // Base Autographs exceptions
  "Base Autographs#20": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#34": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#35": { noVariants: ["Silver"] },
  "Base Autographs#41": { noVariants: ["Silver"] },
  "Base Autographs#44": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#50": { noVariants: ["Silver"] },
  "Base Autographs#52": { noVariants: ["Silver"] },
  "Base Autographs#53": { noVariants: ["Silver"] },
  "Base Autographs#63": { onlyVariants: ["Black Shimmer /1"] },
  "Base Autographs#64": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#68": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#69": { noVariants: ["Silver"] },
  "Base Autographs#70": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#72": { noVariants: ["Silver"] },
  "Base Autographs#73": { noVariants: ["Red Shimmer /35", "Blue Shimmer /25"] },
  "Base Autographs#83": { noVariants: ["Silver"] },
  "Base Autographs#86": { noVariants: ["Silver"] },
  "Base Autographs#100": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#101": { noVariants: ["Red Shimmer /35"] },
  "Base Autographs#108": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#112": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#114": { noVariants: ["Silver"] },
  "Base Autographs#115": { noVariants: ["Silver"] },
  "Base Autographs#119": { noVariants: ["Silver"] },
  "Base Autographs#137": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#139": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#140": { noVariants: ["Silver"] },
  "Base Autographs#144": { noVariants: ["Silver"] },
  "Base Autographs#146": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#152": { noVariants: ["Silver"] },
  "Base Autographs#155": { noVariants: ["Silver"] },
  "Base Autographs#162": { noVariants: ["Silver"] },
  "Base Autographs#163": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#169": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#172": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#177": { noVariants: ["Silver"] },
  "Base Autographs#178": { noVariants: ["Silver"] },
  "Base Autographs#181": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#186": { noVariants: ["Silver"] },
  "Base Autographs#187": { noVariants: ["Silver"] },
  "Base Autographs#188": { noVariants: ["Silver"] },
  "Base Autographs#192": { noVariants: ["Silver"] },
  "Base Autographs#196": { noVariants: ["Silver"] },
  "Base Autographs#215": { noVariants: ["Silver"] },
  "Base Autographs#217": { noVariants: ["Silver"] },
  "Base Autographs#226": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#227": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#231": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#232": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#233": { noVariants: ["Silver"] },
  "Base Autographs#240": { noVariants: ["Silver"] },
  "Base Autographs#242": { noVariants: ["Silver"] },
  "Base Autographs#250": { noVariants: ["Silver"] },
  "Base Autographs#254": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#270": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#274": { onlyVariants: ["Green Shimmer /5", "Black Shimmer /1"] },
  "Base Autographs#276": { noVariants: ["Silver", "Red Shimmer /35"] },
  "Base Autographs#279": { onlyVariants: ["Black Shimmer /1"] },
  "Base Autographs#282": { noVariants: ["Silver"] },
  "Base Autographs#289": { noVariants: ["Silver"] },
  // Base - Rookie Autographs Silver Prizm exceptions
  "Base - Rookie Autographs Silver Prizm#307": { noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#308": {
    noBase: true,
    onlyVariants: [
      "Prizm No Huddle",
      "Prizm Camo /25",
      "Prizm Gold /10",
      "Prizm No Huddle Gold /10",
      "Prizm Gold Vinyl /5",
      "Prizm Green Shimmer /5",
      "Prizm Black Finite /1",
      "Prizm Black Shimmer /1",
      "Prizm No Huddle Black /1",
      "Prizm White Sparkle /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#309": {
    noBase: true,
    onlyVariants: ["Prizm No Huddle", "Prizm Black Finite /1", "Prizm Black Shimmer /1", "Prizm White Sparkle /1"],
  },
  "Base - Rookie Autographs Silver Prizm#314": { noBase: true, noVariants: ["Prizm Pink"] },
  "Base - Rookie Autographs Silver Prizm#316": {
    noBase: true,
    onlyVariants: ["Prizm Gold /10", "Prizm Gold Vinyl /5", "Prizm Black Finite /1", "Prizm Black Shimmer /1"],
  },
  "Base - Rookie Autographs Silver Prizm#318": {
    noBase: true,
    onlyVariants: [
      "Prizm Gold /10",
      "Prizm Gold Vinyl /5",
      "Prizm Black Finite /1",
      "Prizm Black Shimmer /1",
      "Prizm No Huddle Black /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#322": {
    noBase: true,
    onlyVariants: [
      "Prizm Red Shimmer /35",
      "Prizm Blue Shimmer /25",
      "Prizm Green Shimmer /5",
      "Prizm Black Shimmer /1",
      "Prizm Purple Power /49",
      "Prizm Camo /25",
      "Prizm Gold /10",
      "Prizm Gold Vinyl /5",
      "Prizm Black Finite /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#324": {
    noBase: true,
    onlyVariants: ["Prizm Black Finite /1", "Prizm Black Shimmer /1", "Prizm White Sparkle /1"],
  },
  "Base - Rookie Autographs Silver Prizm#325": { noVariants: ["Prizm Pink", "Prizm No Huddle"] },
  "Base - Rookie Autographs Silver Prizm#328": {
    noBase: true,
    onlyVariants: ["Prizm Gold /10", "Prizm Gold Vinyl /5", "Prizm Black Finite /1"],
  },
  "Base - Rookie Autographs Silver Prizm#329": {
    noBase: true,
    onlyVariants: [
      "Prizm No Huddle",
      "Prizm Purple Power /49",
      "Prizm Camo /25",
      "Prizm Gold /10",
      "Prizm Green Shimmer /5",
      "Prizm Gold Vinyl /5",
      "Prizm Black Finite /1",
      "Prizm Black Shimmer /1",
      "Prizm White Sparkle /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#330": {
    noBase: true,
    onlyVariants: [
      "Prizm Gold /10",
      "Prizm Gold Vinyl /5",
      "Prizm Green Shimmer /5",
      "Prizm Black Finite /1",
      "Prizm Black Shimmer /1",
      "Prizm No Huddle Black /1",
      "Prizm White Sparkle /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#334": {
    noBase: true,
    onlyVariants: [
      "Prizm No Huddle",
      "Prizm Gold Vinyl /5",
      "Prizm Green Shimmer /5",
      "Prizm Black Finite /1",
      "Prizm Black Shimmer /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#335": { noVariants: ["Prizm Blue Shimmer /25"] },
  "Base - Rookie Autographs Silver Prizm#336": { noBase: true, noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#338": { noBase: true, noVariants: ["Prizm Pink", "Prizm No Huddle"] },
  "Base - Rookie Autographs Silver Prizm#339": { noBase: true, noVariants: ["Prizm Pink", "Prizm White Sparkle /1"] },
  "Base - Rookie Autographs Silver Prizm#340": {
    noBase: true,
    noVariants: [
      "Prizm Pink",
      "Prizm Purple Pulsar",
      "Prizm Red Wave /149",
      "Prizm Green Scope /75",
      "Prizm Purple Power /49",
      "Prizm Blue Shimmer /25",
      "Prizm No Huddle Gold /10",
      "Prizm No Huddle Black /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#347": { noVariants: ["Prizm Pink", "Prizm No Huddle"] },
  "Base - Rookie Autographs Silver Prizm#349": { noBase: true, noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#358": { noBase: true, noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#359": { noBase: true },
  "Base - Rookie Autographs Silver Prizm#360": { noVariants: ["Prizm Pink", "Prizm Purple Pulsar", "Prizm No Huddle"] },
  "Base - Rookie Autographs Silver Prizm#361": { noBase: true, noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#362": { noVariants: ["Prizm Pink"] },
  "Base - Rookie Autographs Silver Prizm#365": { noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#369": { noBase: true, noVariants: ["Prizm Pink"] },
  "Base - Rookie Autographs Silver Prizm#373": { noVariants: ["Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#374": { noVariants: ["Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#375": {
    noBase: true,
    onlyVariants: ["Prizm No Huddle", "Prizm Camo /25", "Prizm Gold /10", "Prizm Gold Vinyl /5", "Prizm Black Finite /1"],
  },
  "Base - Rookie Autographs Silver Prizm#379": { noVariants: ["Prizm Pink", "Prizm No Huddle"] },
  "Base - Rookie Autographs Silver Prizm#382": { noVariants: ["Prizm Pink", "Prizm No Huddle"] },
  "Base - Rookie Autographs Silver Prizm#383": {
    noBase: true,
    noVariants: ["Prizm Pink", "Prizm Purple Pulsar", "Prizm Red Wave /149", "Prizm Green Scope /75"],
  },
  "Base - Rookie Autographs Silver Prizm#384": {
    noBase: true,
    noVariants: ["Prizm Pink", "Prizm Purple Pulsar", "Prizm No Huddle"],
  },
  "Base - Rookie Autographs Silver Prizm#387": { noVariants: ["Prizm Pink", "Prizm Purple Pulsar"] },
  "Base - Rookie Autographs Silver Prizm#394": {
    noBase: true,
    onlyVariants: [
      "Prizm Blue Shimmer /25",
      "Prizm Green Shimmer /5",
      "Prizm Black Shimmer /1",
      "Prizm White Sparkle /1",
    ],
  },
  "Base - Rookie Autographs Silver Prizm#400": {
    noBase: true,
    noVariants: [
      "Prizm Pink",
      "Prizm Purple Pulsar",
      "Prizm No Huddle",
      "Prizm Red Wave /149",
      "Prizm Green Scope /75",
      "Prizm Purple Power /49",
      "Prizm White Sparkle /1",
    ],
  },
};

const CWC_EXCLUSIONS: Record<string, { noBase?: boolean }> = {
  // Dual Signatures
  "Dual Signatures#1": { noBase: true },
  // Global Graphs
  "Global Graphs#8": { noBase: true },
  "Global Graphs#10": { noBase: true },
  // Signatures
  "Signatures#1": { noBase: true },
  "Signatures#19": { noBase: true },
  "Signatures#25": { noBase: true },
};

const SCORE_EXCLUSIONS: Record<
  string,
  { noBase?: boolean; noVariants?: string[] }
> = {
  // Double Trouble
  "Double Trouble#9": { noBase: true },
  "Double Trouble#12": { noVariants: ["Ground Zero /25"] },
  // It's Good! Graphs
  "It's Good! Graphs#14": { noBase: true },
  // Next Era NIL Autographs
  "Next Era NIL Autographs#3": { noBase: true },
  // Stars of the NFL Jerseys
  "Stars of the NFL Jerseys#37": { noVariants: ["Prime /100"] },
  "Stars of the NFL Jerseys#39": { noVariants: ["Super Prime /1"] },
  // Zoned In Jerseys
  "Zoned In Jerseys#23": { noBase: true },
  "Zoned In Jerseys#35": { noVariants: ["Prime /100"] },
  "Zoned In Jerseys#49": { noBase: true },
};

function shouldExpandVariants(section: string) {
  if (section.startsWith("Rookie Variations Prizms Silver")) return true;
  return !VARIANT_KEYWORDS.some((k) => section.includes(k));
}

function expandChecklistVariants<T extends { section: string }>(items: T[]) {
  const out: T[] = [];
  for (const item of items) {
    out.push(item);
    if (!shouldExpandVariants(item.section)) continue;
    for (const variant of VARIANT_LIST) {
      out.push({ ...item, section: `${item.section} • ${variant.label}` });
    }
  }
  return out;
}

function expandScoreChecklist<T extends { section: string; number: string | number }>(
  items: T[]
) {
  const out: T[] = [];
  for (const item of items) {
    const exclusion = SCORE_EXCLUSIONS[`${item.section}#${item.number}`];
    if (!exclusion?.noBase) out.push(item);
    const variants = SCORE_SECTION_VARIANTS[item.section] ?? [];
    for (const variant of variants) {
      if (exclusion?.noVariants?.includes(variant)) continue;
      out.push({ ...item, section: `${item.section} • ${variant}` });
    }
  }
  return out;
}

function expandPrizmChecklist<T extends { section: string; number: string | number }>(
  items: T[]
) {
  const out: T[] = [];
  for (const item of items) {
    const exclusion = PRIZM_EXCLUSIONS[`${item.section}#${item.number}`];
    const skipBase = PRIZM_SKIP_BASE_SECTIONS.has(item.section);
    if (!skipBase && !exclusion?.noBase) out.push(item);
    let variants = PRIZM_SECTION_VARIANTS[item.section] ?? [];
    if (exclusion?.onlyVariants?.length) {
      variants = variants.filter((v) => exclusion.onlyVariants?.includes(v));
    }
    if (exclusion?.noVariants?.length) {
      variants = variants.filter((v) => !exclusion.noVariants?.includes(v));
    }
    for (const variant of variants) {
      out.push({ ...item, section: `${item.section} • ${variant}` });
    }
  }
  return out;
}

function expandCwcChecklist<T extends { section: string; number: string | number }>(items: T[]) {
  const out: T[] = [];
  for (const item of items) {
    const exclusion = CWC_EXCLUSIONS[`${item.section}#${item.number}`];
    if (!exclusion?.noBase) out.push(item);
    const variants = CWC_SECTION_VARIANTS[item.section] ?? [];
    for (const variant of variants) {
      out.push({ ...item, section: `${item.section} • ${variant}` });
    }
  }
  return out;
}

function expandDonrussChecklist<T extends { section: string; number: string | number }>(
  items: T[]
) {
  const out: T[] = [];
  for (const item of items) {
    if (DONRUSS_EXCLUDED_SECTION_PREFIXES.some((prefix) => item.section.startsWith(prefix))) {
      continue;
    }
    const exclusion = DONRUSS_EXCLUSIONS[`${item.section}#${item.number}`];
    if (!exclusion?.noBase) out.push(item);
    let variants = DONRUSS_SECTION_VARIANTS[item.section] ?? [];
    if (exclusion?.onlyVariants?.length) {
      variants = variants.filter((v) => exclusion.onlyVariants?.includes(v));
    }
    if (exclusion?.noVariants?.length) {
      variants = variants.filter((v) => !exclusion.noVariants?.includes(v));
    }
    for (const variant of variants) {
      out.push({ ...item, section: `${item.section} • ${variant}` });
    }
  }
  return out;
}

function sectionTokens(section: string) {
  return section
    .split("•")
    .map((s) => s.trim())
    .flatMap((s) => s.split("/"))
    .map((s) => s.trim())
    .filter(Boolean);
}

function sectionNumbers(section: string) {
  const matches = section.match(/\b\d+\b/g);
  return matches ?? [];
}

function normalizeQueryTokens(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function applySectionAutoFill(
  section: string,
  setParallel: (v: string) => void,
  setSerialTotal: (v: string) => void,
  setInsert: (v: string) => void
) {
  const [rawBase, rawVariant] = section.split("•").map((s) => s.trim());
  const baseSection = rawBase ?? section;
  const variantSection = rawVariant ?? "";

  if (INSERT_SECTIONS.has(baseSection)) {
    setInsert(baseSection);
  }

  if (variantSection) {
    setParallel(variantSection);
    const match = variantSection.match(/\/\s*(\d+)/);
    setSerialTotal(match ? match[1] : "");
    return;
  }

  if (section.includes("Season Stat Line /")) {
    const match = section.match(/\/\s*(\d+)/);
    setParallel("Season Stat Line");
    if (match) setSerialTotal(match[1]);
    return;
  }

  if (section.includes("Jersey Number /")) {
    const match = section.match(/\/\s*(\d+)/);
    setParallel("Jersey Number");
    if (match) setSerialTotal(match[1]);
    return;
  }

  if (section.includes("Press Proofs Silver Die-Cut")) {
    setParallel("Press Proofs Silver Die-Cut");
    setSerialTotal("99");
    return;
  }
  if (section.includes("Press Proofs Silver")) {
    setParallel("Press Proofs Silver");
    setSerialTotal("199");
    return;
  }
  if (section.includes("Press Proofs Gold Die-Cut")) {
    setParallel("Press Proofs Gold Die-Cut");
    setSerialTotal("25");
    return;
  }
  if (section.includes("Press Proofs Gold")) {
    setParallel("Press Proofs Gold");
    setSerialTotal("50");
    return;
  }
  if (section.includes("Press Proofs Black Die-Cut")) {
    setParallel("Press Proofs Black Die-Cut");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Press Proofs Black")) {
    setParallel("Press Proofs Black");
    setSerialTotal("10");
    return;
  }

  const donrussParallel = [
    "Aqueous Test",
    "Canvas",
    "No Name",
    "Press Proofs Blue",
    "Press Proofs Green",
    "Press Proofs Purple",
    "Press Proofs Red",
    "Press Proofs Yellow",
  ].find((p) => section.includes(p));
  if (donrussParallel) {
    setParallel(donrussParallel);
    setSerialTotal("");
    return;
  }

  const prizmParallels = [
    "Prizm Black and Blue Checker",
    "Prizm Black and Red Checker",
    "Prizm Black and White Checker",
    "Prizm Blue",
    "Prizm Choice Blue Yellow and Green",
    "Prizm Choice Tiger Stripe",
    "Prizm Green Flash",
    "Prizm Green Ice",
    "Prizm Green Wave",
    "Prizm Lazer",
    "Prizm Neon Green Pulsar",
    "Prizm No Huddle",
    "Prizm Orange Ice",
    "Prizm Pink",
    "Prizm Pink Wave",
    "Prizm Press Proof",
    "Prizm Purple Pulsar",
    "Prizm Red",
    "Prizm Red Flash",
    "Prizm Red Sparkle",
    "Prizm Red White and Blue",
    "Prizm Silver",
    "Prizm Snakeskin",
    "Prizm White Disco",
    "Prizm White Sparkle",
    "Prizm Pandora /400",
    "Prizm Orange /249",
    "Prizm Blue Wave /230",
    "Prizm Purple Ice /225",
    "Prizm Hyper /200",
    "Prizm Pigskin /180",
    "Prizm Red Wave /149",
    "Prizm No Huddle Blue /125",
    "Prizm Purple /125",
    "Prizm Blue Ice /99",
    "Prizm No Huddle Red /99",
    "Prizm Purple Wave /99",
    "Prizm Blue Sparkle /96",
    "Prizm Green Scope /75",
    "Prizm No Huddle Purple /75",
    "Prizm Orange Wave /65",
    "Prizm Kangaroo /61",
    "Prizm Super Bowl LX /60",
    "Prizm Purple Power /49",
    "Prizm Red Shimmer /49",
    "Prizm Red and Yellow /44",
    "Prizm Blue Shimmer /35",
    "Prizm White /35",
    "Prizm Navy Camo /25",
    "Prizm No Huddle Pink /25",
    "Prizm Gold Sparkle /24",
    "Prizm Choice Red /20",
    "Prizm Panini Logo /20",
    "Prizm Lotus Flower /18",
    "Prizm Choice Cherry Blossom /15",
    "Prizm Forest Camo /15",
    "Prizm Purple Shimmer /15",
    "Prizm Choice Blue /14",
    "Prizm Choice Gold /10",
    "Prizm Gold /10",
    "Prizm Gold Shimmer /10",
    "Prizm Gold Wave /10",
    "Prizm No Huddle Neon Green /10",
    "Prizm Green Sparkle /8",
    "Prizm Plum Blossom /8",
    "Prizm Gold Vinyl /5",
    "Prizm Green Shimmer /5",
    "Prizm White Knight /3",
    "Prizm Black Finite /1",
    "Prizm Black Shimmer /1",
    "Prizm Black Stars /1",
    "Prizm Choice Nebula /1",
    "Prizm No Huddle Gold /10",
    "Prizm No Huddle Black /1",
    "Prizm Camo /25",
    "Green Wave",
    "No Huddle",
    "Pink Wave",
    "Mojo /25",
    "Red Shimmer /35",
    "Blue Shimmer /25",
    "Green Shimmer /5",
    "Black Shimmer /1",
    "Blue Ice /99",
    "Navy Camo /25",
    "Neon Green Pulsar",
    "Pink",
    "Purple Pulsar",
  ].find((p) => section.includes(p));
  if (prizmParallels) {
    const serialMatch = prizmParallels.match(/\/\s*(\d+)/);
    const label = prizmParallels.replace(/\s*\/\s*\d+$/, "").trim();
    setParallel(label);
    if (serialMatch) setSerialTotal(serialMatch[1]);
    else setSerialTotal("");
    return;
  }
  if (section.includes("Prizms Silver")) {
    setParallel("Prizms Silver");
    setSerialTotal("");
    return;
  }
  if (section.includes("Prizm Silver")) {
    setParallel("Prizm Silver");
    setSerialTotal("");
    return;
  }
  if (section.includes("Silver")) {
    setParallel("Silver");
    setSerialTotal("");
    return;
  }

  if (section.includes("Showcase")) {
    setParallel("Showcase");
    if (section.includes("/100")) setSerialTotal("100");
    else if (section.includes("/250")) setSerialTotal("250");
    else setSerialTotal("");
    return;
  }
  if (section.includes("Cubic /50")) {
    setParallel("Cubic");
    setSerialTotal("50");
    return;
  }
  if (section.includes("Cubic")) {
    setParallel("Cubic");
    setSerialTotal("185");
    return;
  }
  if (section.includes("Cosmic /100")) {
    setParallel("Cosmic");
    setSerialTotal("100");
    return;
  }
  if (section.includes("Electric")) {
    setParallel("Electric");
    setSerialTotal("99");
    return;
  }
  if (section.includes("Lava /10")) {
    setParallel("Lava");
    setSerialTotal("10");
    return;
  }
  if (section.includes("Lava")) {
    setParallel("Lava");
    setSerialTotal("799");
    return;
  }
  if (section.includes("Dots Gold")) {
    setParallel("Dots Gold");
    setSerialTotal("499");
    return;
  }

  const serialMatch = section.match(/\/\s*(\d+)/);
  if (serialMatch) {
    setSerialTotal(serialMatch[1]);
  }
  if (section.includes("Stars")) {
    setParallel("Stars");
    setSerialTotal("499");
    return;
  }
  if (section.includes("Spokes")) {
    setParallel("Spokes");
    setSerialTotal("415");
    return;
  }
  if (section.includes("Bats")) {
    setParallel("Bats");
    setSerialTotal("399");
    return;
  }
  if (section.includes("Dots Blue")) {
    setParallel("Dots Blue");
    setSerialTotal("399");
    return;
  }
  if (section.includes("Ellipse")) {
    setParallel("Ellipse");
    setSerialTotal("399");
    return;
  }
  if (section.includes("Circular")) {
    setParallel("Circular");
    setSerialTotal("299");
    return;
  }
  if (section.includes("Trick or Treat")) {
    setParallel("Trick or Treat");
    setSerialTotal("99");
    return;
  }
  if (section.includes("Holo /100")) {
    setParallel("Holo");
    setSerialTotal("100");
    return;
  }
  if (section.includes("Gold /10")) {
    setParallel("Gold");
    setSerialTotal("10");
    return;
  }
  if (section.includes("Black /1")) {
    setParallel("Black");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Super Prime")) {
    setParallel("Super Prime");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Prime")) {
    setParallel("Prime");
    if (section.includes("/100")) setSerialTotal("100");
    else if (section.includes("/49")) setSerialTotal("49");
    else if (section.includes("/25")) setSerialTotal("25");
    return;
  }
  if (section.includes("Ground Zero")) {
    setParallel("Ground Zero");
    setSerialTotal("25");
    return;
  }
  if (section.includes("Galactic")) {
    setParallel("Galactic");
    setSerialTotal("");
    return;
  }
  if (section.includes("Studio Series")) {
    setParallel("Studio Series");
    setSerialTotal("100");
    return;
  }
  if (section.includes("Laundry Tag Brand Logo")) {
    setParallel("Laundry Tag Brand Logo");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Laundry Tag NFL Players")) {
    setParallel("Laundry Tag NFL Players");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Laundry Tag NFL Shield")) {
    setParallel("Laundry Tag NFL Shield");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Laundry Tag Player's Logo")) {
    setParallel("Laundry Tag Player's Logo");
    setSerialTotal("1");
    return;
  }
  if (section.includes("NFL Shield")) {
    setParallel("NFL Shield");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Neon Green Pulsar")) {
    setParallel("Neon Green Pulsar");
    setSerialTotal("");
    return;
  }
  if (section.includes("Purple Pulsar")) {
    setParallel("Purple Pulsar");
    setSerialTotal("");
    return;
  }
  if (section.includes("Pink")) {
    setParallel("Pink");
    setSerialTotal("");
    return;
  }
  if (section.includes("Football Emoji")) {
    setParallel("Football Emoji");
    setSerialTotal("");
    return;
  }
  if (section.includes("Green Velocity")) {
    setParallel("Green Velocity");
    setSerialTotal("");
    return;
  }
  if (section.includes("Red and Green")) {
    setParallel("Red and Green");
    setSerialTotal("");
    return;
  }
  if (section.includes("Red Pandora")) {
    setParallel("Red Pandora");
    setSerialTotal("");
    return;
  }
  if (section.includes("Red Power")) {
    setParallel("Red Power");
    setSerialTotal("");
    return;
  }
  if (section.includes("Blue Scope /100")) {
    setParallel("Blue Scope");
    setSerialTotal("100");
    return;
  }
  if (section.includes("Purple /50")) {
    setParallel("Purple");
    setSerialTotal("50");
    return;
  }
  if (section.includes("Green Pandora /25")) {
    setParallel("Green Pandora");
    setSerialTotal("25");
    return;
  }
  if (section.includes("Gold Ice /10")) {
    setParallel("Gold Ice");
    setSerialTotal("10");
    return;
  }
  if (section.includes("Gold Zone")) {
    setParallel("Gold Zone");
    setSerialTotal("50");
    return;
  }
  if (section.includes("Artist's Proof")) {
    setParallel("Artist's Proof");
    setSerialTotal("35");
    return;
  }
  if (section.includes("Red Zone")) {
    setParallel("Red Zone");
    setSerialTotal("20");
    return;
  }
  if (section.includes("First Down")) {
    setParallel("First Down");
    setSerialTotal("10");
    return;
  }
  if (section.includes("End Zone")) {
    setParallel("End Zone");
    setSerialTotal("6");
    return;
  }
  if (section.includes("Gem Masters")) {
    setParallel("Gem Masters");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Die-Cut")) {
    setParallel("Die-Cut");
    setSerialTotal("10");
    return;
  }
  if (section.includes("Webs")) {
    setParallel("Webs");
    setSerialTotal("31");
    return;
  }
  if (section.includes("Dots Red")) {
    setParallel("Dots Red");
    setSerialTotal("25");
    return;
  }
  if (section.includes("Printing Plates")) {
    if (section.includes("Black")) setParallel("Printing Plates Black");
    else if (section.includes("Cyan")) setParallel("Printing Plates Cyan");
    else if (section.includes("Magenta")) setParallel("Printing Plates Magenta");
    else if (section.includes("Yellow")) setParallel("Printing Plates Yellow");
    else setParallel("Printing Plates");
    setSerialTotal("1");
    return;
  }
  if (section.includes("Rookie Dynamics")) {
    setParallel("Rookie Dynamics");
    return;
  }
  if (section.includes("Extraterrestrial")) {
    setParallel("Extraterrestrial");
    return;
  }
  if (section.includes("Scorecard")) {
    setParallel("Scorecard");
    return;
  }

  const color = ["Gold", "Orange", "Pink", "Purple", "Red"].find((c) => section.includes(c));
  if (color) {
    setParallel(color);
    setSerialTotal("");
  }
}

function inferFlagsFromSection(section: string) {
  const isRookie = section.includes("Rookie");
  const isAutograph = section.includes("Signatures") || section.includes("Autographs") || section.includes("NIL");
  const isMemorabilia =
    !isAutograph &&
    (section.includes("Jersey") ||
      section.includes("Jerseys") ||
      section.includes("Threads") ||
      section.includes("Sweater") ||
      section.includes("Kings"));
  return { isRookie, isAutograph, isMemorabilia };
}

function checklistGroup(section: string) {
  if (section.startsWith("Base") || section === "Rookies" || section === "Mystery Rookie Redemption") {
    return "Base / Rookies";
  }
  if (section.includes("Signatures") || section.includes("Autographs") || section.includes("NIL")) {
    return "Autographs";
  }
  if (
    section.includes("Jersey") ||
    section.includes("Jerseys") ||
    section.includes("Threads") ||
    section.includes("Sweater") ||
    section.includes("Kings")
  ) {
    return "Memorabilia";
  }
  if (INSERT_SECTIONS.has(section)) return "Inserts";
  return "Parallels";
}

function uid() {
  // good enough for local MVP
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

function toNum(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

// ✅ One-time migration: move legacy localStorage "cards" into lib/storage
function migrateLegacyCardsOnce() {
  try {
    const raw = localStorage.getItem("cards");
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    for (const item of parsed) {
      // upsert into your real storage layer
      upsertCard(item as SportsCard);
    }

    // remove legacy key so it doesn’t keep re-importing
    localStorage.removeItem("cards");
  } catch {
    // ignore
  }
}

function NewCardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isWishlist = searchParams.get("wishlist") === "1";
  const isForSaleIntent = searchParams.get("forSale") === "1";

  // ✅ migrate once on first mount
  useEffect(() => {
    migrateLegacyCardsOnce();
    try {
      const cards = loadCards();
      const set = new Set<string>();
      for (const c of cards) {
        const raw = (((c as any).location as string | undefined) ?? "").trim();
        if (raw) set.add(raw);
      }
      setLocationOptions(Array.from(set).sort((a, b) => a.localeCompare(b)));
    } catch {
      // ignore
    }
  }, []);

  const [playerName, setPlayerName] = useState("");
  const [year, setYear] = useState("");
  const [setName, setSetName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [team, setTeam] = useState("");
  const [setQuery, setSetQuery] = useState("");
  const [showSetResults, setShowSetResults] = useState(false);
  const [checklistQuery, setChecklistQuery] = useState("");
  const [showChecklistResults, setShowChecklistResults] = useState(false);
  const [checklistSection, setChecklistSection] = useState<"ALL" | string>("ALL");

  // ✅ NEW
  const [location, setLocation] = useState("");
  const [locationOptions, setLocationOptions] = useState<string[]>([]);

  const [condition, setCondition] = useState<CardCondition>("RAW");
  const [grader, setGrader] = useState("");
  const [grade, setGrade] = useState("");

  const [status, setStatus] = useState<CardStatus>("HAVE");
  const [purchasePrice, setPurchasePrice] = useState<string>("");
  const [purchaseDate, setPurchaseDate] = useState<string>("");

  // ✅ Collector fields
  const [variation, setVariation] = useState("");
  const [insert, setInsert] = useState("");
  const [parallel, setParallel] = useState("");
  const [serialNumber, setSerialNumber] = useState<string>("");
  const [serialTotal, setSerialTotal] = useState<string>("");

  const [isRookie, setIsRookie] = useState(false);
  const [isAutograph, setIsAutograph] = useState(false);
  const [isPatch, setIsPatch] = useState(false);

  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageIsFront, setImageIsFront] = useState(true);
  const [imageIsSlabbed, setImageIsSlabbed] = useState(false);
  const [imageShare, setImageShare] = useState(false);
  const [imageOwnerConfirm, setImageOwnerConfirm] = useState(false);
  const [imageType, setImageType] = useState<
    "front" | "back" | "slab_front" | "slab_back"
  >("front");
  const [imageError, setImageError] = useState<string>("");
  const [imageCheckStatus, setImageCheckStatus] = useState<
    "idle" | "checking" | "accept" | "review" | "block"
  >("idle");
  const [cardPhotoConfirm, setCardPhotoConfirm] = useState(false);
  const [reportInfo, setReportInfo] = useState<{ reports: number; status?: string } | null>(
    null
  );

  const [cropData, setCropData] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [cropSource, setCropSource] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropRotationBase, setCropRotationBase] = useState(0);
  const [cropRotationFine, setCropRotationFine] = useState(0);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const cropDragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const CROP_FRAME_W = 320;
  const CROP_FRAME_H = 448;
  const CROP_FRAME_PAD = 8;
  const CROP_BOX_W = CROP_FRAME_W - CROP_FRAME_PAD * 2;
  const CROP_BOX_H = CROP_FRAME_H - CROP_FRAME_PAD * 2;
  const CROP_ZOOM_MIN = 1;
  const CROP_ZOOM_MAX = 1.5;
  const CROP_ROTATION_FINE_MIN = -10;
  const CROP_ROTATION_FINE_MAX = 10;

  const fingerprint = useMemo(
    () =>
      buildCardFingerprint({
        year,
        setName,
        cardNumber,
        playerName,
        team,
        insert,
        variation,
        parallel,
      }),
    [year, setName, cardNumber, playerName, team, insert, variation, parallel]
  );

  const sharedImage = useMemo(
    () => (fingerprint ? getSharedImage(fingerprint) : null),
    [fingerprint]
  );

  useEffect(() => {
    if (!fingerprint) {
      setReportInfo(null);
      return;
    }
    fetch("/api/image-reports/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprints: [fingerprint] }),
    })
      .then((r) => r.json())
      .then((data) => {
        const item = data?.[fingerprint];
        if (item) setReportInfo({ reports: item.reports ?? 0, status: item.status });
        else setReportInfo(null);
      })
      .catch(() => setReportInfo(null));
  }, [fingerprint]);

  useEffect(() => {
    if (isWishlist) {
      setStatus("WANT");
      return;
    }
    if (isForSaleIntent) {
      setStatus("FOR_SALE");
    }
  }, [isWishlist, isForSaleIntent]);

  const isWishlistCard = isWishlist || status === "WANT";

  useEffect(() => {
    if (!isWishlistCard) return;
    setLocation("");
    setPurchasePrice("");
    setPurchaseDate("");
    setImageUrl(null);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setCardPhotoConfirm(false);
  }, [isWishlistCard]);

  function clampCropOffset(
    next: { x: number; y: number },
    data: { width: number; height: number }
  ) {
    const baseScale = Math.max(CROP_BOX_W / data.width, CROP_BOX_H / data.height);
    const scale = baseScale * cropZoom;
    const scaledW = data.width * scale;
    const scaledH = data.height * scale;
    const maxX = Math.max(0, (scaledW - CROP_BOX_W) / 2);
    const maxY = Math.max(0, (scaledH - CROP_BOX_H) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  useEffect(() => {
    if (!cropData) return;
    setCropOffset((prev) => clampCropOffset(prev, cropData));
  }, [cropZoom, cropData]);

  async function runImageCheck(dataUrl: string) {
    const res = await fetch("/api/image-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    });
    const data = await res.json();
    if (!res.ok || data?.message) {
      setImageCheckStatus("review");
      return;
    }
    if (data.decision === "block") {
      setImageCheckStatus("block");
      setImageUrl(null);
      setImageError(
        "This doesn’t look like a card photo. Please upload a picture of the card."
      );
      return;
    }
    setImageCheckStatus(data.decision === "review" ? "review" : "accept");
  }

  async function confirmCrop() {
    if (!cropData) return;
    const baseScale = Math.max(CROP_BOX_W / cropData.width, CROP_BOX_H / cropData.height);
    const scale = baseScale * cropZoom;
    const rawCropW = CROP_BOX_W / scale;
    const rawCropH = CROP_BOX_H / scale;
    const cropW = Math.min(cropData.width, rawCropW);
    const cropH = Math.min(cropData.height, rawCropH);
    const x = cropData.width / 2 + ((-CROP_BOX_W / 2 - cropOffset.x) / scale);
    const y = cropData.height / 2 + ((-CROP_BOX_H / 2 - cropOffset.y) / scale);
    const cropped = await cropImageDataUrl(cropData.dataUrl, {
      x: Math.max(0, Math.min(cropData.width - cropW, x)),
      y: Math.max(0, Math.min(cropData.height - cropH, y)),
      width: cropW,
      height: cropH,
    }, "image/webp", 0.92, { width: CROP_BOX_W, height: CROP_BOX_H });
    setImageUrl(cropped);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setCardPhotoConfirm(false);
    setShowCrop(false);
    setCropData(null);
    setImageCheckStatus("checking");
    await runImageCheck(cropped);
  }

  async function applyCropRotation(nextBase: number, nextFine: number) {
    if (!cropSource) return;
    try {
      const totalRotation = nextBase + nextFine;
      const rotated = await rotateImageDataUrl(cropSource.dataUrl, totalRotation);
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        setCropData({ dataUrl: rotated, width, height });
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setCropRotationBase(nextBase);
        setCropRotationFine(nextFine);
      };
      img.onerror = () => {
        setImageError("Failed to rotate image.");
      };
      img.src = rotated;
    } catch {
      setImageError("Failed to rotate image.");
    }
  }

  const canSave = useMemo(() => {
    const baseOk = Boolean(playerName.trim() && year.trim() && setName.trim());
    if (!imageUrl) return baseOk;
    return baseOk && cardPhotoConfirm;
  }, [playerName, year, setName, imageUrl, cardPhotoConfirm]);

  const setResults = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    const list = q
      ? SET_LIBRARY.filter((s) => {
          const hay = [s.year, s.name, s.brand ?? "", s.sport ?? ""].join(" ").toLowerCase();
          return hay.includes(q);
        })
      : SET_LIBRARY;
    const scored = list.map((s) => {
      let score = 0;
      if (s.checklistKey) score += 3;
      if (q) {
        const name = s.name.toLowerCase();
        const full = `${s.year} ${s.name}`.toLowerCase();
        if (full === q) score += 5;
        if (name.includes(q)) score += 2;
        if (s.year.toLowerCase().includes(q)) score += 1;
      }
      return { s, score };
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.s.name.localeCompare(b.s.name);
    });
    return scored.map((item) => item.s).slice(0, 12);
  }, [setQuery]);

  const checklistKey = useMemo(() => {
    const y = year.trim();
    const name = setName.trim().toLowerCase();
    if (!y || !name) return null;

    const exact = SET_LIBRARY.find(
      (s) => s.checklistKey && s.year === y && s.name.toLowerCase() === name
    );
    if (exact?.checklistKey) return exact.checklistKey;

    const fuzzy = SET_LIBRARY.find(
      (s) =>
        s.checklistKey &&
        s.year === y &&
        (name.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(name))
    );
    return fuzzy?.checklistKey ?? null;
  }, [year, setName]);

  const activeChecklist = useMemo(() => {
    if (checklistKey === "donruss-2025") {
      return [
        ...expandDonrussChecklist(DONRUSS_2025_CHECKLIST),
        ...expandDonrussChecklist(DONRUSS_2025_AUTOGRAPHS),
        ...expandDonrussChecklist(DONRUSS_2025_MEMORABILIA),
        ...expandDonrussChecklist(DONRUSS_2025_INSERTS),
      ];
    }
    if (checklistKey === "prizm-cwc-2025") {
      return [...expandCwcChecklist(PRIZM_2025_FIFA_CLUB_WORLD_CUP_CHECKLIST)];
    }
    if (checklistKey === "prizm-2025") {
      return [
        ...expandPrizmChecklist(PRIZM_2025_CHECKLIST),
        ...expandPrizmChecklist(PRIZM_2025_AUTOGRAPHS),
        ...expandPrizmChecklist(PRIZM_2025_MEMORABILIA),
        ...expandPrizmChecklist(PRIZM_2025_INSERTS),
      ];
    }
    if (checklistKey === "score-2025") {
      return [
        ...expandScoreChecklist(SCORE_2025_CHECKLIST),
        ...expandScoreChecklist(SCORE_2025_AUTOGRAPHS),
        ...expandScoreChecklist(SCORE_2025_MEMORABILIA),
        ...expandScoreChecklist(SCORE_2025_INSERTS),
      ];
    }
    return [];
  }, [checklistKey]);

  const checklistResults = useMemo(() => {
    if (!activeChecklist.length) return [];
    const qTokens = normalizeQueryTokens(checklistQuery);
    const list = qTokens.length
      ? activeChecklist.filter((c) => {
          const tokens = sectionTokens(c.section);
          const numbers = sectionNumbers(c.section);
          const hayRaw = [
            c.number,
            c.name,
            c.team ?? "",
            c.section,
            ...tokens,
            ...numbers,
          ]
            .join(" ")
            .toLowerCase();
          const hay = hayRaw.replace(/[^a-z0-9]+/g, " ").trim();
          return qTokens.every((t) => hay.includes(t));
        })
      : activeChecklist;
    const filtered =
      checklistSection === "ALL"
        ? list
        : list.filter((c) => checklistGroup(c.section) === checklistSection);
    const base = filtered.filter((c) => !VARIANT_KEYWORDS.some((k) => c.section.includes(k)));
    const variants = filtered.filter((c) => VARIANT_KEYWORDS.some((k) => c.section.includes(k)));
    return [...base, ...variants].slice(0, 200);
  }, [activeChecklist, checklistQuery, checklistSection]);

  const checklistGroups = useMemo(() => {
    if (!activeChecklist.length) return [];
    const counts = new Map<string, number>();
    for (const c of activeChecklist) {
      const group = checklistGroup(c.section);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [activeChecklist]);

  function handleImageFile(file: File | null) {
    if (!file) return;
    setImageError("");
    setImageCheckStatus("checking");
    processImageFile(file)
      .then(async (result) => {
        setCropSource({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropData({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setCropRotationBase(0);
        setCropRotationFine(0);
        setShowCrop(true);
      })
      .catch((err: Error) => {
        setImageCheckStatus("idle");
        setImageError(err.message || "Image failed validation.");
      });
  }

  function buildCard(): SportsCard | null {
    if (!canSave) return null;

    const now = new Date().toISOString();

    const card: SportsCard = {
      id: uid(),
      playerName: playerName.trim(),
      year: year.trim(),
      setName: setName.trim(),
      cardNumber: cardNumber.trim() || undefined,
      team: team.trim() || undefined,

      // ✅ NEW
      location: isWishlistCard ? undefined : location.trim() || undefined,

      condition,
      grader: condition === "GRADED" ? (grader.trim() || undefined) : undefined,
      grade: condition === "GRADED" ? (grade.trim() || undefined) : undefined,

      status: isWishlistCard ? "WANT" : status,

      purchasePrice: isWishlistCard ? undefined : toNum(purchasePrice),
      purchaseDate: isWishlistCard ? undefined : purchaseDate || undefined,

      variation: variation.trim() || undefined,
      insert: insert.trim() || undefined,
      parallel: parallel.trim() || undefined,
      serialNumber: isWishlistCard ? undefined : toNum(serialNumber),
      serialTotal: toNum(serialTotal),

      isRookie: isRookie || undefined,
      isAutograph: isAutograph || undefined,
      isPatch: isPatch || undefined,

      notes: notes.trim() || undefined,

      imageUrl: isWishlistCard ? undefined : imageUrl || undefined,
      imageShared: isWishlistCard ? undefined : imageShare || undefined,
      imageIsFront: isWishlistCard ? undefined : imageIsFront,
      imageIsSlabbed: isWishlistCard ? undefined : imageIsSlabbed,
      imageType: isWishlistCard ? undefined : imageType,

      createdAt: now,
      updatedAt: now,
    };

    return card;
  }

  function onSave() {
    const card = buildCard();
    if (!card) return;
    upsertCard(card);
    if (
      !isWishlistCard &&
      imageShare &&
      imageOwnerConfirm &&
      imageUrl &&
      fingerprint &&
      imageUrl.trim().length > 0
    ) {
      saveSharedImage({
        fingerprint,
        dataUrl: imageUrl,
        isFront: imageIsFront,
        isSlabbed: imageIsSlabbed,
        createdAt: new Date().toISOString(),
      });
    }
    router.push("/cards");
  }

  function onSaveAndAddAnother() {
    const card = buildCard();
    if (!card) return;
    upsertCard(card);
    if (
      !isWishlistCard &&
      imageShare &&
      imageOwnerConfirm &&
      imageUrl &&
      fingerprint &&
      imageUrl.trim().length > 0
    ) {
      saveSharedImage({
        fingerprint,
        dataUrl: imageUrl,
        isFront: imageIsFront,
        isSlabbed: imageIsSlabbed,
        createdAt: new Date().toISOString(),
      });
    }

    setPlayerName("");
    setCardNumber("");
    setTeam("");
    setLocation("");
    setCondition("RAW");
    setGrader("");
    setGrade("");
    setStatus("HAVE");
    setPurchasePrice("");
    setPurchaseDate("");
    setVariation("");
    setInsert("");
    setParallel("");
    setSerialNumber("");
    setSerialTotal("");
    setIsRookie(false);
    setIsAutograph(false);
    setIsPatch(false);
    setNotes("");
    setImageUrl(null);
    setImageIsFront(true);
    setImageIsSlabbed(false);
    setImageShare(false);
    setImageOwnerConfirm(false);
    setImageType("front");
    setImageError("");
    setImageCheckStatus("idle");
    setCardPhotoConfirm(false);
    setChecklistQuery("");
    setChecklistSection("ALL");
    setShowChecklistResults(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add Card</h1>
          <p className="text-sm text-zinc-600">Add a new card to your binder.</p>
        </div>
        <Link href="/cards" className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50">
          Back
        </Link>
      </div>

      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-zinc-900">Set lookup</label>
          <div className="relative">
            <input
              value={setQuery}
              onChange={(e) => {
                setSetQuery(e.target.value);
                setShowSetResults(true);
              }}
              onFocus={() => setShowSetResults(true)}
              onBlur={() => {
                window.setTimeout(() => setShowSetResults(false), 120);
              }}
              placeholder="Search sets (e.g., 2018 Prizm, Topps Chrome)"
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            />
            {showSetResults && setResults.length ? (
              <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                {setResults.map((s) => (
                  <button
                    key={`${s.year}-${s.name}-${s.brand ?? ""}-${s.sport ?? ""}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setYear(s.year);
                      setSetName(s.name);
                      setSetQuery(`${s.year} ${s.name}`);
                      if (s.checklistKey) {
                        setChecklistQuery("");
                        setChecklistSection("ALL");
                      }
                      setShowSetResults(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    <div className="font-medium text-zinc-900">
                      {s.year} {s.name}
                    </div>
                    <div className="text-xs text-zinc-900">
                      {[s.brand, s.sport, s.checklistKey ? "Checklist" : ""]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-900">
            Pick a set to auto-fill <span className="font-medium">Year</span> and{" "}
            <span className="font-medium">Set</span>.
          </p>
        </div>

        {activeChecklist.length ? (
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-900">Checklist search</label>
            <div className="relative">
              <input
                value={checklistQuery}
                onChange={(e) => {
                  setChecklistQuery(e.target.value);
                  setShowChecklistResults(true);
                }}
                onFocus={() => setShowChecklistResults(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowChecklistResults(false), 120);
                }}
                placeholder="Search name, number, team..."
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
              />
              {showChecklistResults && checklistResults.length ? (
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                  {checklistResults.map((c: ChecklistEntry) => (
                    <button
                      key={`${c.section}-${c.number}-${c.name}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setCardNumber(c.number);
                        setPlayerName(c.name);
                        if (c.team) setTeam(c.team);
                        if (typeof c.section === "string") {
                          if (c.section === "Anniversary Rookies") {
                            setInsert("Anniversary Rookies");
                            setParallel("");
                            setSerialTotal("");
                          }
                          applySectionAutoFill(c.section, setParallel, setSerialTotal, setInsert);
                          const flags = inferFlagsFromSection(c.section);
                          setIsRookie(flags.isRookie);
                          setIsAutograph(flags.isAutograph);
                          setIsPatch(flags.isMemorabilia);
                        }
                        setChecklistQuery(`${c.number} ${c.name}`);
                        setShowChecklistResults(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <div className="font-medium text-zinc-900">
                        #{c.number} {c.name}
                      </div>
                      <div className="text-xs text-zinc-900">
                        {[c.team, c.section].filter(Boolean).join(" • ")}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-zinc-900">
              Selecting a card fills <span className="font-medium">Player</span>,{" "}
              <span className="font-medium">Card #</span>, and{" "}
              <span className="font-medium">Team</span>.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setChecklistSection("ALL")}
                className={
                  "min-h-[56px] rounded-lg border px-4 py-3 text-left text-sm transition " +
                  (checklistSection === "ALL"
                    ? "border-zinc-900 bg-[#2b323a] text-white"
                    : "bg-white hover:bg-zinc-50")
                }
              >
                <div className="text-[11px] uppercase tracking-wide opacity-80 truncate">All</div>
                <div className="text-base font-semibold">{activeChecklist.length}</div>
              </button>

              {checklistGroups.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setChecklistSection(g.label)}
                  className={
                    "min-h-[56px] rounded-lg border px-4 py-3 text-left text-sm transition " +
                    (checklistSection === g.label
                      ? "border-zinc-900 bg-[#2b323a] text-white"
                      : "bg-white hover:bg-zinc-50")
                  }
                >
                  <div className="text-[11px] uppercase tracking-wide opacity-80 truncate">
                    {g.label}
                  </div>
                  <div className="text-base font-semibold">{g.count}</div>
                </button>
              ))}
            </div>
          </div>
        ) : setName.trim() && year.trim() ? (
          <div className="sm:col-span-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            Checklist is only available after selecting a set with a checklist.
          </div>
        ) : null}

        {!isWishlistCard ? (
        <div className="sm:col-span-2">
          <div className="text-sm font-medium text-zinc-900">Card image</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-[140px_1fr]">
            <div className="relative aspect-[2.5/3.5] rounded-md border bg-zinc-50 p-1 flex items-center justify-center overflow-hidden">
              {(() => {
                const hideCommunity =
                  reportInfo &&
                  (reportInfo.status === "blocked" ||
                    reportInfo.reports >= REPORT_HIDE_THRESHOLD);
                const display = imageUrl || (!hideCommunity ? sharedImage?.dataUrl : "");
                if (display) {
                  return (
                    <img
                      src={display}
                      alt="Card"
                      className="h-full w-full object-contain"
                    />
                  );
                }
                if (hideCommunity) {
                  return (
                    <div className="text-[11px] text-zinc-500 text-center px-2">
                      Image hidden (reported)
                    </div>
                  );
                }
                return <div className="text-[11px] text-zinc-500 text-center px-2">No image</div>;
              })()}
              <div className="pointer-events-none absolute inset-2 rounded-sm border border-dashed border-zinc-300/70" />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <label className="rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 cursor-pointer">
                  Upload card photo (front/back)
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleImageFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                {sharedImage?.dataUrl &&
                !imageUrl &&
                !(
                  reportInfo &&
                  (reportInfo.status === "blocked" ||
                    reportInfo.reports >= REPORT_HIDE_THRESHOLD)
                ) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl(sharedImage.dataUrl);
                      setImageOwnerConfirm(false);
                      setImageShare(false);
                    }}
                    className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                  >
                    Use community image
                  </button>
                ) : null}

                {imageUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl(null);
                      setImageOwnerConfirm(false);
                      setImageShare(false);
                    }}
                    className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                  >
                    Remove image
                  </button>
                ) : null}
              </div>

              <div className="grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="imageType"
                    value="front"
                    checked={imageType === "front"}
                    onChange={() => {
                      setImageType("front");
                      setImageIsFront(true);
                      setImageIsSlabbed(false);
                    }}
                  />
                  Front of card
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="imageType"
                    value="back"
                    checked={imageType === "back"}
                    onChange={() => {
                      setImageType("back");
                      setImageIsFront(false);
                      setImageIsSlabbed(false);
                    }}
                  />
                  Back of card
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="imageType"
                    value="slab_front"
                    checked={imageType === "slab_front"}
                    onChange={() => {
                      setImageType("slab_front");
                      setImageIsFront(true);
                      setImageIsSlabbed(true);
                    }}
                  />
                  Slab front
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="imageType"
                    value="slab_back"
                    checked={imageType === "slab_back"}
                    onChange={() => {
                      setImageType("slab_back");
                      setImageIsFront(false);
                      setImageIsSlabbed(true);
                    }}
                  />
                  Slab back
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={cardPhotoConfirm}
                  onChange={(e) => setCardPhotoConfirm(e.target.checked)}
                />
                I confirm this is a photo of the card (or slab).
              </label>

              <div className="rounded-md border bg-zinc-50 p-2 text-xs text-zinc-600">
                <div className="font-medium text-zinc-800">Community reference (optional)</div>
                <div>
                  Share a photo you took so others can see an example image for this exact card.
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={imageOwnerConfirm}
                      onChange={(e) => setImageOwnerConfirm(e.target.checked)}
                    />
                    I own this photo
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={!imageOwnerConfirm || !imageUrl}
                      checked={imageShare}
                      onChange={(e) => setImageShare(e.target.checked)}
                    />
                    Allow as community reference
                  </label>
                </div>
              </div>

              {imageError ? (
                <div className="text-xs text-red-600">{imageError}</div>
              ) : null}

              {imageCheckStatus === "checking" ? (
                <div className="text-xs text-zinc-500">Checking image…</div>
              ) : null}
              {imageCheckStatus === "review" ? (
                <div className="text-xs text-amber-600">
                  Image needs review. Please confirm this is a card photo.
                </div>
              ) : null}
              {imageCheckStatus === "accept" ? (
                <div className="text-xs text-emerald-600">Image looks like a card.</div>
              ) : null}
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            {imageUrl
              ? "Using your image."
              : sharedImage?.dataUrl
              ? "Community image (example)."
              : "No image yet."}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Allowed: JPG/PNG/WebP/HEIC • Max {Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)}MB •
            Min {IMAGE_RULES.minWidth}×{IMAGE_RULES.minHeight}
          </div>
        </div>
        ) : null}

        <Field label="Player" value={playerName} onChange={setPlayerName} placeholder="Baker Mayfield" />

        <Field label="Year" value={year} onChange={setYear} placeholder="2018" />
        <Field label="Set" value={setName} onChange={setSetName} placeholder="Panini Prizm" />
        <Field label="Card #" value={cardNumber} onChange={setCardNumber} placeholder="123" />
        <Field label="Team" value={team} onChange={setTeam} placeholder="Browns" />

        {!isWishlistCard ? (
          <div>
            <label className="block text-xs font-medium text-zinc-600">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Binder A / Box 1 / Safe"
              list="location-options"
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            />
            <datalist id="location-options">
              {locationOptions.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </div>
        ) : null}

        <Select
          label="Condition"
          value={condition}
          onChange={(v) => setCondition(v as CardCondition)}
          options={[
            ["RAW", "Raw"],
            ["GRADED", "Graded"],
          ]}
        />

        {/* ✅ Only show grading fields when needed (no empty grid gaps) */}
        {condition === "GRADED" ? (
          <>
            <Field label="Grader" value={grader} onChange={setGrader} placeholder="PSA" />
            <Field label="Grade" value={grade} onChange={setGrade} placeholder="10" />
          </>
        ) : null}

        {!isWishlist ? (
          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as CardStatus)}
            options={[
              ["HAVE", "Have"],
              ["WANT", "Want"],
              ["FOR_SALE", "For Sale"],
              ["SOLD", "Sold"],
            ]}
          />
        ) : null}

        {!isWishlistCard ? (
          <>
            <Field label="Paid" value={purchasePrice} onChange={setPurchasePrice} placeholder="50" />
            <Field label="Purchase date" value={purchaseDate} onChange={setPurchaseDate} type="date" />
          </>
        ) : null}

        <div className="sm:col-span-2 mt-2 border-t pt-4">
          <div className="text-sm font-medium text-zinc-900">Variations / Parallels</div>
          <div className="text-xs text-zinc-500">
            Examples: Base, Silver, Refractor, X-Fractor, Wave, Pink, /99, etc.
          </div>
        </div>

        <Field label="Variation" value={variation} onChange={setVariation} placeholder="Refractor" />
        <Field label="Insert" value={insert} onChange={setInsert} placeholder="Kaboom" />
        <Field label="Parallel" value={parallel} onChange={setParallel} placeholder="Pink Wave" />
        {isWishlistCard ? (
          <Field label="Serial total" value={serialTotal} onChange={setSerialTotal} placeholder="99" />
        ) : null}

        {!isWishlistCard ? (
          <>
            <Field label="Serial #" value={serialNumber} onChange={setSerialNumber} placeholder="12" />
            <Field label="Serial total" value={serialTotal} onChange={setSerialTotal} placeholder="99" />
          </>
        ) : null}

        <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
          <Check label="Rookie" checked={isRookie} onChange={setIsRookie} />
          <Check label="Autograph" checked={isAutograph} onChange={setIsAutograph} />
          <Check label="Patch/Relic" checked={isPatch} onChange={setIsPatch} />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-zinc-900">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            rows={3}
            placeholder="Any extra details…"
          />
        </div>

        <div className="sm:col-span-2 flex justify-end gap-2">
          <Link href="/cards" className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50">
            Cancel
          </Link>
          <button
            onClick={onSaveAndAddAnother}
            disabled={!canSave}
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-40"
          >
            Save + Add Another
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Save Card
          </button>
        </div>
      </div>

      {showCrop && cropData ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setShowCrop(false);
            setCropData(null);
            setImageCheckStatus("idle");
          }}
        >
          <div
            className="w-full max-w-xl rounded-2xl border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-semibold">Crop your card photo</div>
            <div className="mt-1 text-xs text-zinc-500">
              The image starts fill-to-frame to match your binder preview. Drag to crop or zoom in.
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[320px_1fr]">
              <div
                className="relative h-[448px] w-[320px] rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-2"
                onPointerDown={(e) => {
                  if (!cropData) return;
                  const target = e.target as HTMLElement;
                  if (!target.closest("[data-crop-viewport]")) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  cropDragRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: cropOffset.x,
                    oy: cropOffset.y,
                  };
                }}
                onPointerMove={(e) => {
                  if (!cropData || !cropDragRef.current) return;
                  const dx = e.clientX - cropDragRef.current.x;
                  const dy = e.clientY - cropDragRef.current.y;
                  const next = clampCropOffset(
                    { x: cropDragRef.current.ox + dx, y: cropDragRef.current.oy + dy },
                    cropData
                  );
                  setCropOffset(next);
                }}
                onPointerUp={(e) => {
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                  cropDragRef.current = null;
                }}
                onPointerCancel={(e) => {
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                  cropDragRef.current = null;
                }}
              >
                <div
                  data-crop-viewport
                  className="relative h-[432px] w-[304px] overflow-hidden rounded-md border border-zinc-200 bg-white/70"
                >
                  <img
                    src={cropData.dataUrl}
                    alt="Crop preview"
                    draggable={false}
                    className="absolute left-1/2 top-1/2 select-none max-w-none max-h-none"
                    style={{
                      width: cropData.width,
                      height: cropData.height,
                      transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) translate(-50%, -50%) scale(${
                        Math.max(CROP_BOX_W / cropData.width, CROP_BOX_H / cropData.height) * cropZoom
                      })`,
                    }}
                  />
                  <div className="pointer-events-none absolute inset-1 rounded-sm border border-white/40" />
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextBase = cropRotationBase - 90;
                      applyCropRotation(nextBase, cropRotationFine);
                    }}
                    className="rounded-md border bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
                  >
                    Rotate Left
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextBase = cropRotationBase + 90;
                      applyCropRotation(nextBase, cropRotationFine);
                    }}
                    className="rounded-md border bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
                  >
                    Rotate Right
                  </button>
                </div>
                <label className="mb-2 block text-zinc-600">Rotation</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={CROP_ROTATION_FINE_MIN}
                    max={CROP_ROTATION_FINE_MAX}
                    step={1}
                    value={cropRotationFine}
                    onChange={(e) => {
                      const nextFine = Number(e.target.value);
                      applyCropRotation(cropRotationBase, nextFine);
                    }}
                    className="w-full"
                  />
                  <span className="w-12 text-right">
                    {cropRotationBase + cropRotationFine}°
                  </span>
                </div>
                <label className="mb-2 mt-4 block text-zinc-600">Zoom</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={CROP_ZOOM_MIN}
                    max={CROP_ZOOM_MAX}
                    step={0.05}
                    value={cropZoom}
                    onChange={(e) => setCropZoom(Number(e.target.value))}
                    className="w-full"
                  />
                  <span className="w-10 text-right">{Math.round(cropZoom * 100)}%</span>
                </div>
                <div className="mt-3">Tip: drag the image to align it in the frame.</div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCrop(false);
                  setCropData(null);
                  setCropSource(null);
                  setImageCheckStatus("idle");
                }}
                className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmCrop().catch((err: Error) => {
                    setImageCheckStatus("idle");
                    setImageError(err.message || "Image failed validation.");
                  });
                }}
                className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32]"
              >
                Use Crop
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function NewCardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-10 pt-6">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-full animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-full animate-pulse rounded bg-zinc-200" />
          <div className="h-9 w-full animate-pulse rounded bg-zinc-200" />
        </div>
      }
    >
      <NewCardPageInner />
    </Suspense>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const isDate = type === "date";
  const inputClass =
    "mt-1 w-full min-w-0 max-w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 " +
    (isDate ? "appearance-none" : "");

  return (
    <div className="min-w-0 w-full">
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className={inputClass}
        onClick={(e) => {
          if (!isDate) return;
          const el = e.currentTarget;
          if (typeof (el as HTMLInputElement).showPicker === "function") {
            (el as HTMLInputElement).showPicker();
          }
        }}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm text-zinc-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-zinc-900"
      />
      <span className="font-medium">{label}</span>
    </label>
  );
}
