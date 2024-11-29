"use client";

import cn from "classnames";
import React, { useState, ReactNode } from "react";

type TailoredContentOptionProps = {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
};

export function TailoredContentOption({ title, description, icon, children }: TailoredContentOptionProps) {
  // This is just a type definition component - it won't render anything
  return <div>{children}</div>;
}

type TailoredContentProps = {
  children: ReactNode;
  className?: string;
  defaultOptionIndex?: number;
};

export function TailoredContent({ children, className, defaultOptionIndex = 0 }: TailoredContentProps) {
  // Get options from children
  const options = React.Children.toArray(children).filter(
    (child) => React.isValidElement(child)
  ) as React.ReactElement<TailoredContentOptionProps>[];

  if (options.length === 0) {
    throw new Error("TailoredContent must have at least one TailoredContentOption child");
  }

  if (defaultOptionIndex < 0 || defaultOptionIndex >= options.length) {
    throw new Error("Default option index is out of bounds");
  }

  const [selectedIndex, setSelectedIndex] = useState(defaultOptionIndex);

  const itemCn =
    "border p-4 rounded-md flex-1 flex md:block md:space-y-1 items-center md:items-start gap-4 cursor-pointer bg-white dark:bg-secondary relative overflow-hidden group transition-all";
  const selectedCn =
    "shadow-lg ring-1 ring-indigo-400 selected bg-gradient-to-r from-indigo-100/80 to-purple-200 dark:from-indigo-900/20 dark:to-purple-900/30";
  const iconCn =
    "w-10 h-10 mb-4 top-0 transition-all opacity-20 group-[.selected]:text-indigo-500 group-[.selected]:opacity-60 dark:group-[.selected]:text-indigo-400 dark:group-[.selected]:opacity-60 dark:text-gray-400";

  return (
    <div>
      <div className={cn("tailored-content-wrapper mt-4", className)}>
        <div className="flex flex-col md:flex-row gap-3 my-2 w-full">
          {options.map((option, index) => (
            <div
              key={index}
              className={cn(itemCn, selectedIndex === index && selectedCn)}
              onClick={() => setSelectedIndex(index)}
              style={{ position: "relative" }}
            >
              <div className="my-0">
                {React.cloneElement(option.props.icon as React.ReactElement, {
                  className: cn(iconCn, selectedIndex === index, "my-0"),
                })}
              </div>
              <div>
                <p className="font-semibold text-lg">{option.props.title}</p>
                <p className="text-xs md:text-sm">{option.props.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {options[selectedIndex]?.props.children}
    </div>
  );
}
