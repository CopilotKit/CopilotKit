import Page, { mdxComponents } from "@/app/(home)/[[...slug]]/page"

export async function RenderMDX({ children }: { children: React.ReactNode }) {
  return (
    <Page params={{}}>
      {children}
    </Page>
  )
}