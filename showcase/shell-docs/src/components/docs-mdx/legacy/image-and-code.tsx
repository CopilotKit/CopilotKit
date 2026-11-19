// Import shim for a legacy snippet that imports `ImageAndCode` without using
// it; kept so the import resolves. Renders an image beside its code.
import type { ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";

export function ImageAndCode({
  image,
  alt = "",
  children,
}: {
  image?: string;
  alt?: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? (
        <img src={withBasePath(image)} alt={alt} className="rounded-lg" />
      ) : null}
      <div>{children}</div>
    </div>
  );
}
