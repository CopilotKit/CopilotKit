"use client";
import { MoreHorizontal } from "lucide-react";
import { navLinks } from "@/app/layout.config";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";

export function MenuButton() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button 
        className="p-2 rounded-md hover:bg-accent"
        onClick={() => setIsOpen(!isOpen)}
      >
        <MoreHorizontal className="h-5 w-5" />
        <span className="sr-only">Menu</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-50">
          <div className="py-1">
            {navLinks.map((link, index) => (
              <Link
                key={index}
                href={link.url}
                className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setIsOpen(false)}
              >
                <span className="mr-2">{link.icon}</span>
                {link.text}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
