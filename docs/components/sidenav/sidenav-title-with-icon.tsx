import React from "react";
import { IconType } from "react-icons";

export function SideNavTitleWithIcon({
  title,
  icon: Icon,
}: {
  title: string;
  icon?: IconType;
}) {
  return (
    <div className="icon-container flex items-center gap-x-2">
      <div className="icon size-[28px] rounded-md border border-gray-300 flex items-center justify-center">
        {Icon && <Icon className="ck-icon size-[16px]" />}
      </div>
      <span className="font-medium">{title}</span>
    </div>
  );
}
