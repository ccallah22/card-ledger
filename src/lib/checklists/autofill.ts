import { INSERT_SECTIONS } from "@/lib/checklists/parallelExpansion";

export function applySectionAutoFill(
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

export function inferFlagsFromSection(section: string) {
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

export function checklistGroup(section: string) {
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

export function toNum(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}
