import type { ReactNode } from "react";
import { Callout } from "fumadocs-ui/components/callout";

interface DeprecationNoticeProps {
  deprecatedName: string;
  replacementName: string;
  replacementHref: string;
  guideHref?: string;
  children?: ReactNode;
}

export function DeprecationNotice({
  deprecatedName,
  replacementName,
  replacementHref,
  guideHref,
  children,
}: DeprecationNoticeProps) {
  return (
    <Callout type="warning">
      <div className="space-y-3">
        <p>
          <strong>{deprecatedName} is deprecated.</strong> Use{" "}
          <a href={replacementHref}>{replacementName}</a> instead.
          {guideHref ? (
            <>
              {" "}
              See the <a href={guideHref}>migration guide</a> for codemod and
              manual migration steps.
            </>
          ) : null}
        </p>
        {children ? <div>{children}</div> : null}
      </div>
    </Callout>
  );
}
