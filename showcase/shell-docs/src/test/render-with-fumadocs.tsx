import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { FrameworkProvider } from "fumadocs-core/framework";
import type { Router } from "fumadocs-core/framework";

export function renderWithFumadocs(
  children: ReactNode,
  router: Router,
  pathname = "/",
) {
  const wrap = (content: ReactNode) => (
    <FrameworkProvider
      usePathname={() => pathname}
      useParams={() => ({})}
      useRouter={() => router}
    >
      {content}
    </FrameworkProvider>
  );
  const result = render(wrap(children));
  return {
    ...result,
    rerender(content: ReactNode) {
      result.rerender(wrap(content));
    },
  };
}
