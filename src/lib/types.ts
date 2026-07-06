export type CardStatus = "HAVE" | "WANT" | "FOR_SALE" | "SOLD";

export type GradingStatus = "RAW" | "GRADED";

export type CardCondition =
  | "MINT"
  | "NEAR_MINT_MINT"
  | "NEAR_MINT"
  | "EXCELLENT"
  | "VERY_GOOD"
  | "GOOD"
  | "FAIR"
  | "POOR";

export type ImageType = "front" | "back" | "slab_front" | "slab_back";

export type Player = {
  id: string;
  leagueId?: string | null;
  teamId?: string | null;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  slug: string;
  searchText?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Card = {
  id: string;
  setId: string;
  cardNumber: string;
  title?: string | null;
  rookieCard: boolean;
  printedYear?: number | null;
  releaseYear?: number | null;
  isInsert: boolean;
  isAutograph: boolean;
  isMemorabilia: boolean;
  searchText?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CardVariant = {
  id: string;
  cardId: string;
  parallelTypeId?: string | null;
  nameOverride?: string | null;
  serialNumbered: boolean;
  printRun?: number | null;
  hasAutograph: boolean;
  hasMemorabilia: boolean;
  isRefractor: boolean;
  isDieCut: boolean;
  isShortPrint: boolean;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Location = {
  id: string;
  profileId: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UserCard = {
  id: string;
  profileId: string;
  cardId: string;
  cardVariantId?: string | null;
  locationId?: string | null;

  gradingStatus: GradingStatus;
  condition?: CardCondition | null;
  gradingCompanyId?: string | null;
  grade?: string | null;
  certNumber?: string | null;

  status: CardStatus;

  purchasePrice?: number | null;
  purchaseDate?: string | null;
  purchaseSource?: string | null;

  estimatedValue?: number | null;

  askingPrice?: number | null;
  soldPrice?: number | null;
  soldDate?: string | null;
  soldFees?: number | null;
  soldNotes?: string | null;

  quantity: number;
  notes?: string | null;

  imagePath?: string | null;
  thumbPath?: string | null;
  imageShared?: boolean | null;
  imageType?: ImageType | null;

  createdAt?: string;
  updatedAt?: string;
};

export type CardComp = {
  id: string;
  price: number;
  date?: string;
  source?: string;
  url?: string;
  notes?: string;
};

