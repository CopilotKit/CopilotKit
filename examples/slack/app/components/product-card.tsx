/**
 * `ProductCard` — a presentational product tile. Host-tag JSX with Tailwind
 * brand classes. Used as the child of `<Render>` so Takumi draws it to a PNG
 * while the surrounding carousel card stays native channel UI.
 */
export interface ProductCardProps {
  name: string;
  price: string;
  color: string;
  tag?: string;
}

export function ProductCard({ name, price, color, tag }: ProductCardProps) {
  return (
    <div className="flex flex-col justify-end w-full h-full gap-3 p-8 bg-brand-bg font-brand">
      <div
        className="w-full rounded-xl"
        style={{ backgroundColor: color, height: 112 }}
      />
      {tag ? (
        <span className="text-sm font-bold text-brand-mint-deep">{tag}</span>
      ) : null}
      <span className="text-2xl font-bold text-brand-ink">{name}</span>
      <span className="text-base text-brand-muted">{price}</span>
    </div>
  );
}
