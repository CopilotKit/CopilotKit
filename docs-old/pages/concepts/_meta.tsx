import { SideNavTitleWithIcon } from "@/components/sidenav/sidenav-title-with-icon";
import { FaReact } from "react-icons/fa";
import { PiGraphDuotone } from "react-icons/pi";
import { LuBrush } from "react-icons/lu";
import { HiOutlineServerStack } from "react-icons/hi2";


export default {
  "self-hosting": {
    title: <SideNavTitleWithIcon title="Self Hosting" icon={HiOutlineServerStack} />,
  },
  "different-llm-adapters": {
    title: <SideNavTitleWithIcon title="LLM Adapters" icon={HiOutlineServerStack} />,
  },
  "agents": {
    title: <SideNavTitleWithIcon title="Agents (LangChain)" icon={PiGraphDuotone} />,
  },
}

