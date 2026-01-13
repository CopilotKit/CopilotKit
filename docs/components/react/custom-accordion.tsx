import { Accordion } from "fumadocs-ui/components/accordion";

interface CustomAccordionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function CustomAccordion({
  title,
  children,
  icon,
}: CustomAccordionProps) {
  const value = title.toLowerCase().replace(/\s+/g, "-");

  return (
    <Accordion
      value={value}
      title={
        <div className="flex items-center gap-4">
          <div className="opacity-60 group-hover:opacity-100 group-data-[state=open]:opacity-100 transition-opacity duration-300">
            {icon}
          </div>
          <div className="text-base font-medium! text-[#010507] dark:text-white">
            {title}
          </div>
        </div>
      }
      className="group bg-[#FFFFFF80] border-none! accordion-icon-right dark:bg-[#01050780] rounded-lg hover:bg-[#FFFFFF] dark:hover:bg-[#FFFFFF0D] transition-all duration-300"
    >
      {children}
    </Accordion>
  );
}
