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
      className={`grid grid-cols-1 lg:grid-cols-2 gap-8 items-center my-8 ${imagePosition === "left" ? "lg:flex-row-reverse" : ""} ${className}`}
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
              className="rounded-lg w-full h-auto block dark:hidden"
            />
            <Image
              src={imageSrcDark}
              alt={imageAlt}
              width={imageWidth}
              height={imageHeight}
              className="rounded-lg w-full h-auto hidden dark:block"
            />
          </>
        ) : (
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={imageWidth}
            height={imageHeight}
            className="rounded-lg w-full h-auto"
          />
        )}
      </div>
    </div>
  );
}
