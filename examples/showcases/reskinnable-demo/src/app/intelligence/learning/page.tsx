import { redirect } from "next/navigation";
import { LEDGERLINE_CONTAINER_ID } from "@/intelligence-ui/ids";

export default function LearningIndex() {
  redirect(`/intelligence/learning/${LEDGERLINE_CONTAINER_ID}`);
}
