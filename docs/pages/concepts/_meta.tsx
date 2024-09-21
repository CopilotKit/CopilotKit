import { SideNavTitleWithIcon } from "@/components/sidenav/sidenav-title-with-icon";
import { FaReact } from "react-icons/fa";
import { PiGraphDuotone } from "react-icons/pi";
import { LuBrush } from "react-icons/lu";
import { HiOutlineServerStack } from "react-icons/hi2";


export default {
  "generative-ui": {
    title: <SideNavTitleWithIcon title="Generative UI" icon={FaReact} />,
  },
  "self-hosting": {
    title: <SideNavTitleWithIcon title="Self Hosting" icon={HiOutlineServerStack} />,
  },
  "different-llm-providers": {
    title: <SideNavTitleWithIcon title="LLM Providers" icon={HiOutlineServerStack} />,
  },
  "agents": {
    title: <SideNavTitleWithIcon title="Agents (LangChain)" icon={PiGraphDuotone} />,
  },
  "customize-look-and-feel": {
    title: <SideNavTitleWithIcon title="Customize Look & Feel" icon={LuBrush} />,
  }
}

