import { CatalogSearch } from "@/components/catalog/CatalogSearch";

export default function CatalogPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="text-sm text-zinc-600">Browse the shared card catalog.</p>
      </div>

      <CatalogSearch />
    </div>
  );
}
