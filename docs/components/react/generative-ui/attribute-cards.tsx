"use client";

import Image from "next/image";

interface AttributeCard {
  title: string;
  content: string;
  imageSrc: string;
  imageAlt: string;
}

interface AttributeCardsProps {
  cards: AttributeCard[];
}

export function AttributeCards({ cards }: AttributeCardsProps) {
  return (
    <div className="my-8 grid grid-cols-1 gap-6 md:grid-cols-2">
      {cards.map((card, index) => (
        <div
          key={index}
          className="bg-card border-border flex flex-col gap-4 rounded-lg border p-6 md:p-8"
        >
          <h3 className="text-2xl font-semibold">{card.title}</h3>
          <p className="text-muted-foreground">{card.content}</p>
          <div className="mt-4">
            <Image
              src={card.imageSrc}
              alt={card.imageAlt}
              width={500}
              height={300}
              className="h-auto w-full rounded-lg"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
