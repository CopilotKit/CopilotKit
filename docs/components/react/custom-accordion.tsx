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
  return (
    <Accordion
      title={
        <div className="flex items-center gap-4">
          {icon}
          <div className="text-base font-medium! text-[#010507] dark:text-white">
            {title}
          </div>
        </div>
      }
      className="bg-[#FFFFFF80] border-none! accordion-icon-right dark:bg-[#01050780] rounded-lg hover:bg-[#FFFFFF] dark:hover:bg-[#FFFFFF0D] transition-all duration-300"
    >
      {children}
    </Accordion>
  );
}
