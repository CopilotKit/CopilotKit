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
          <div className="opacity-60 transition-opacity duration-300 group-hover:opacity-100 group-data-[state=open]:opacity-100">
            {icon}
          </div>
          <div className="text-base font-medium! text-[#010507] dark:text-white">
            {title}
          </div>
        </div>
      }
      className="group accordion-icon-right rounded-lg border-none! bg-[#FFFFFF80] transition-all duration-300 hover:bg-[#FFFFFF] dark:bg-[#01050780] dark:hover:bg-[#FFFFFF0D]"
    >
      {children}
    </Accordion>
  );
}
