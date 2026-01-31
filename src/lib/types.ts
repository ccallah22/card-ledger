export type CardStatus = "HAVE" | "WANT" | "FOR_SALE" | "SOLD";
export type CardCondition = "RAW" | "GRADED";

export type CardComp = {
  id: string;
  price: number;
  date?: string; // YYYY-MM-DD
  source?: string;
  url?: string;
  notes?: string;
};

export type SportsCard = {
  id: string;

  playerName: string;
  year: string;
  setName: string;
  cardNumber?: string;
  team?: string;

  // ✅ NEW: Location tracking (Binder A / Box 1 / Safe, etc.)
  location?: string;

  condition: CardCondition;
  grader?: string;
  grade?: string;

  status: CardStatus;

  purchasePrice?: number;
  purchaseDate?: string; // YYYY-MM-DD

  notes?: string;

  // Selling/listing fields
  askingPrice?: number;

  // Sold / realized fields
  soldPrice?: number;
  soldDate?: string; // YYYY-MM-DD
  soldFees?: number; // optional fees paid on the sale (platform fees, shipping, etc.)
  soldNotes?: string; // optional notes about the sale (buyer/platform/etc.)

  // ✅ Collector features: variations/parallels
  variation?: string; // e.g., Base / Refractor / Silver / Wave
  insert?: string; // e.g., Kaboom / Downtown / Color Blast
  parallel?: string; // optional separate field if you want
  serialNumber?: number; // e.g., 12
  serialTotal?: number; // e.g., 99 (for 12/99)

  // ✅ Collector flags
  isRookie?: boolean;
  isAutograph?: boolean;
  isPatch?: boolean;

  // ✅ Market comps
  comps?: CardComp[];

  // ✅ Images
  imageUrl?: string; // data URL for user-owned image
  imageShared?: boolean; // consent to use as shared reference
  imageIsFront?: boolean;
  imageIsSlabbed?: boolean;
  imageType?: "front" | "back" | "slab_front" | "slab_back";

  // Timestamps (helpful for future features like "recently added", "inventory age", etc.)
  createdAt?: string; // ISO string
  updatedAt?: string; // ISO string
};
