import ExcelJS from "exceljs";

/**
 * Generates a synthetic fixture matching the real Beckett/Panini
 * "2025-Select-Football-Checklist.xlsx" format (a "Master Checklist" sheet
 * with the 10 columns described in the XLSX importer task), since the real
 * file wasn't available in this environment. Run once to (re)produce
 * 2025-select-football-sample.xlsx; not part of the importer pipeline
 * itself.
 *
 * Row design deliberately covers: repeated CARD SET values that should
 * dedupe into one Set entity each ("Base" x3, "Rated Rookies" x3), CARD SET
 * text that should trigger the autograph/memorabilia keyword inference
 * ("Rookie Patch Autographs" -> both, "Rookie Signatures" -> autograph
 * only, "Jersey Materials" -> memorabilia only), a team name
 * ("Chicago Bears") deliberately absent from the known-team heuristic list
 * to show that gap honestly, and one row with a blank ATHLETE to exercise
 * the existing empty-required-field validation warning.
 */

const rows: Array<[string, number, string, string, string, string, string, string, number, string]> = [
  ["Football", 2025, "Panini", "Select", "Base", "Patrick Mahomes", "Kansas City Chiefs", "QB", 1, ""],
  ["Football", 2025, "Panini", "Select", "Base", "CeeDee Lamb", "Dallas Cowboys", "WR", 2, ""],
  ["Football", 2025, "Panini", "Select", "Rated Rookies", "Marvin Harrison Jr.", "Cincinnati Bengals", "WR", 101, ""],
  ["Football", 2025, "Panini", "Select", "Rated Rookies", "Malik Nabers", "New York Giants", "WR", 102, ""],
  ["Football", 2025, "Panini", "Select", "Rookie Patch Autographs", "Caleb Williams", "Chicago Bears", "QB", 201, "/99"],
  ["Football", 2025, "Panini", "Select", "Rookie Signatures", "Malik Nabers", "New York Giants", "WR", 301, "/199"],
  ["Football", 2025, "Panini", "Select", "Jersey Materials", "Justin Jefferson", "Minnesota Vikings", "WR", 401, "/149"],
  ["Football", 2025, "Panini", "Select", "Prizm Silver", "Joe Burrow", "Cincinnati Bengals", "QB", 501, "1:24 HOBBY"],
  ["Football", 2025, "Panini", "Select", "Rated Rookies", "Rome Odunze", "Philadelphia Eagles", "WR", 103, ""],
  ["Football", 2025, "Panini", "Select", "Base", "", "Cleveland Browns", "RB", 3, ""],
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master Checklist");

  sheet.addRow([
    "SPORT",
    "YEAR",
    "BRAND",
    "PROGRAM",
    "CARD SET",
    "ATHLETE",
    "TEAM",
    "POSITION",
    "CARD NUMBER",
    "SEQUENCE",
  ]);
  for (const row of rows) sheet.addRow(row);

  const outPath = "scripts/catalog-import/fixtures/2025-select-football-sample.xlsx";
  await workbook.xlsx.writeFile(outPath);
  console.log(`Wrote ${rows.length} data rows to ${outPath}`);
}

main();
