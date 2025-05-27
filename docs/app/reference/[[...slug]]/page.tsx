import { referenceSource } from "@/app/source";
import Page, { generateStaticParams as baseGenerateStaticParams, generateMetadata as baseGenerateMetadata } from "@/lib/page-utils";

export default async function HomePageWrapper(props: { params: { slug?: string[] } }) {
  return Page({ ...props, source: referenceSource, basePath: "/reference" });
}

export async function generateStaticParams() {
  return baseGenerateStaticParams({ source: referenceSource, basePath: "/reference" });
}

export function generateMetadata(props: { params: { slug?: string[] } }) {
  return baseGenerateMetadata({ ...props, source: referenceSource, basePath: "/reference" });
}
