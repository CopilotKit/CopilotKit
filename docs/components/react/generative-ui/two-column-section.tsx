"use client";

import Image from "next/image";
import { ReactNode } from "react";

interface TwoColumnSectionProps {
  imagePosition: "left" | "right";
  imageSrc: string;
  imageSrcDark?: string;
  imageAlt: string;
  imageWidth?: number;
  imageHeight?: number;
  children: ReactNode;
  className?: string;
}

export function TwoColumnSection({
  imagePosition,
  imageSrc,
  imageSrcDark,
  imageAlt,
  imageWidth = 600,
  imageHeight = 400,
  children,
  className = "",
}: TwoColumnSectionProps) {
  return (
    <div
      className={`my-8 grid grid-cols-1 items-center gap-8 lg:grid-cols-2 ${imagePosition === "left" ? "lg:flex-row-reverse" : ""} ${className}`}
    >
      <div
        className={`${imagePosition === "left" ? "lg:order-2" : "lg:order-1"}`}
      >
        {children}
      </div>
      <div
        className={`${imagePosition === "left" ? "lg:order-1" : "lg:order-2"}`}
      >
        {imageSrcDark ? (
          <>
            <Image
              src={imageSrc}
              alt={imageAlt}
              width={imageWidth}
              height={imageHeight}
              className="block h-auto w-full rounded-lg dark:hidden"
            />
            <Image
              src={imageSrcDark}
              alt={imageAlt}
              width={imageWidth}
              height={imageHeight}
              className="hidden h-auto w-full rounded-lg dark:block"
            />
          </>
        ) : (
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={imageWidth}
            height={imageHeight}
            className="h-auto w-full rounded-lg"
          />
        )}
      </div>
    </div>
  );
}
