import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { BrandConfig } from '@/types/demo';
import Image from 'next/image';

interface BrandSelectorProps {
  value: string;
  onChange: (brandId: string) => void;
}

const brands: BrandConfig[] = [
  {
    id: 'default',
    name: 'CopilotKit',
    logo: '/copilotkit-logo.svg',
    primaryColor: '#1D0E2F',
    secondaryColor: '#6366f1',
  },
  // Add more brands here
];

export function BrandSelector({ value, onChange }: BrandSelectorProps) {
  const selectedBrand = brands.find((b) => b.id === value) || brands[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-auto px-2">
          <Image
            src={selectedBrand.logo}
            alt={selectedBrand.name}
            width={32}
            height={32}
            className="mr-2"
          />
          <span className="font-medium">{selectedBrand.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        {brands.map((brand) => (
          <DropdownMenuItem
            key={brand.id}
            onClick={() => onChange(brand.id)}
            className="flex items-center"
          >
            <Image
              src={brand.logo}
              alt={brand.name}
              width={24}
              height={24}
              className="mr-2"
            />
            {brand.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 