import { SideNavTitleWithIcon } from "@/components/sidenav/sidenav-title-with-icon";
import { HiOutlineServerStack } from "react-icons/hi2";
import { PiGraphDuotone } from "react-icons/pi";


export default {
  "self-hosting": {
    title: <SideNavTitleWithIcon title="Self-Hosting" icon={HiOutlineServerStack} />,
  },
  "different-llm-adapters": {
    title: <SideNavTitleWithIcon title="LLM Adapters" icon={HiOutlineServerStack} />,
  },
  "agents": {
    title: <SideNavTitleWithIcon title="Agents (LangChain)" icon={PiGraphDuotone} />,
  },
}

