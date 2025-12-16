'use client';

import { useState } from 'react';
import { V150EarlyAccessModal } from '@/components/layout/v150-early-access-modal';

export function V150SignupLink({ children }: { children: React.ReactNode }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="text-primary hover:underline font-medium cursor-pointer bg-transparent border-none p-0"
      >
        {children}
      </button>
      
      <V150EarlyAccessModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </>
  );
}

