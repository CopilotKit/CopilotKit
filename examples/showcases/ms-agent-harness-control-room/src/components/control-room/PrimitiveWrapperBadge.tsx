import { Badge } from "@/components/ui/badge";

export function PrimitiveWrapperBadge() {
  return (
    <Badge
      variant="outline"
      className="h-5 text-[10px]"
      title="Live wrapper — app-owned implementation pending native Harness AG-UI support."
    >
      wrapper
    </Badge>
  );
}
