"use client";

import { createContext, useContext, type ComponentProps } from "react";
import {
  Accordion as FumadocsAccordion,
  Accordions as FumadocsAccordions,
} from "fumadocs-ui/components/accordion";

const InAccordions = createContext(false);

/** Fumadocs' accordion group. */
export function Accordions(props: ComponentProps<typeof FumadocsAccordions>) {
  return (
    <InAccordions.Provider value={true}>
      <FumadocsAccordions {...props} />
    </InAccordions.Provider>
  );
}

/**
 * Fumadocs' accordion item. shell-docs let an `<Accordion>` stand alone, so
 * one outside `<Accordions>` brings its own group.
 */
export function Accordion({
  featured: _featured,
  description: _description,
  ...props
}: ComponentProps<typeof FumadocsAccordion> & {
  featured?: boolean;
  description?: string;
}) {
  const grouped = useContext(InAccordions);
  const item = <FumadocsAccordion {...props} />;
  return grouped ? item : <Accordions>{item}</Accordions>;
}
