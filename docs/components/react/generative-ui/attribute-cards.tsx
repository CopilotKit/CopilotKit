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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
      {cards.map((card, index) => (
        <div
          key={index}
          className="bg-card border border-border rounded-lg p-6 md:p-8 flex flex-col gap-4"
        >
          <h3 className="text-2xl font-semibold">{card.title}</h3>
          <p className="text-muted-foreground">{card.content}</p>
          <div className="mt-4">
            <Image
              src={card.imageSrc}
              alt={card.imageAlt}
              width={500}
              height={300}
              className="rounded-lg w-full h-auto"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
