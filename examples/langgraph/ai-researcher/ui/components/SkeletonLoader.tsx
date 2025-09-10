import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonLoader() {
  return (
    <div className="grid grid-cols-10 gap-x-2 gap-y-4">
      <Skeleton className="h-4 col-span-2" />
      <Skeleton className="h-4 col-span-4" />
      <Skeleton className="h-4 col-span-4" />

      <Skeleton className="h-4 col-span-4" />
      <Skeleton className="h-4 col-span-6" />

      <Skeleton className="h-4 col-span-3" />
      <Skeleton className="h-4 col-span-3" />
      <Skeleton className="h-4 col-span-4" />

      <Skeleton className="h-4 col-span-5" />
      <Skeleton className="h-4 col-span-3" />
      <Skeleton className="h-4 col-span-2" />

      <Skeleton className="h-4 col-span-2" />
      <Skeleton className="h-4 col-span-4" />
      <Skeleton className="h-4 col-span-3" />
      <Skeleton className="h-4 col-span-1" />
    </div>
  )
}