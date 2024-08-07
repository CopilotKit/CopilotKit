import { IoChevronUpOutline } from "react-icons/io5";
import cn from "classnames";
import { useState } from "react";

export function Accordion({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string | React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-[#fffdfa] border rounded-md">
      <div className="flex py-3 px-4 bg-neutral-100 items-center gap-2 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <div className="flex-1 font-medium">{title}</div>
        <IoChevronUpOutline className={cn("w-4 h-4", !isOpen && "rotate-180")} />
      </div>
      <div className={cn("p-2", !isOpen && "hidden")}>{children}</div>
    </div>
  );
}
