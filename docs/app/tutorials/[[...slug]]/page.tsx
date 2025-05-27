import { tutorialsSource } from "@/app/source";
import Page, { generateStaticParams as baseGenerateStaticParams, generateMetadata as baseGenerateMetadata } from "@/lib/page-utils";

export default async function HomePageWrapper(props: { params: { slug?: string[] } }) {
  return Page({ ...props, source: tutorialsSource, basePath: "/tutorials" });
}

export async function generateStaticParams() {
  return baseGenerateStaticParams({ source: tutorialsSource, basePath: "/tutorials" });
}

export function generateMetadata(props: { params: { slug?: string[] } }) {
  return baseGenerateMetadata({ ...props, source: tutorialsSource, basePath: "/tutorials" });
}
