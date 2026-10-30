"use client";

import { Accordion as UIAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { RendererMap } from "./types";

/**
 * Column, Row, Grid, Card, Tabs, Divider and Carousel render with the Gen UI
 * 2.0 standard components. Child references arrive already rendered.
 */
export const layoutRenderers: RendererMap<"Section" | "Accordion"> = {
  Section: ({ props }) => (
    <section className="a2-enter flex w-full min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h3 className="text-[15px] font-semibold tracking-tight">{props.title}</h3>
          {props.eyebrow ? <span className="a2-label">{props.eyebrow}</span> : null}
        </div>
        {props.description ? <p className="text-[12.5px] leading-relaxed text-muted-foreground">{props.description}</p> : null}
      </header>
      <div className="flex min-w-0 flex-col gap-3">{props.children}</div>
    </section>
  ),

  Accordion: ({ props }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const body = items.map((it, i) => (
      <AccordionItem key={i} value={String(i)} className="border-[var(--a2-line)] px-4 last:border-b-0">
        <AccordionTrigger className="text-[13px] font-medium hover:no-underline">{it.title}</AccordionTrigger>
        <AccordionContent className="text-[12.5px] leading-relaxed text-muted-foreground">
          {it.text ? <p>{it.text}</p> : null}
          {it.child ?? null}
        </AccordionContent>
      </AccordionItem>
    ));
    return props.multiple ? (
      <UIAccordion type="multiple" className="a2-card a2-enter w-full min-w-0">
        {body}
      </UIAccordion>
    ) : (
      <UIAccordion type="single" collapsible defaultValue="0" className="a2-card a2-enter w-full min-w-0">
        {body}
      </UIAccordion>
    );
  },
};
