import { LearningScreen } from "@/intelligence-ui/screens/learning-screen";

export default async function LearningContainerPage({
  params,
}: {
  params: Promise<{ container: string; tab?: string[] }>;
}) {
  const { container, tab } = await params;
  return <LearningScreen containerId={decodeURIComponent(container)} tab={tab?.[0] ?? null} />;
}
