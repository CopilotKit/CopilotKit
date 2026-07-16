import type { MDXRemoteProps } from "next-mdx-remote/rsc";

type MdxRemoteOptions = NonNullable<MDXRemoteProps["options"]>;

export function createTrustedMdxRemoteOptions(
  options: MdxRemoteOptions,
): MdxRemoteOptions {
  return {
    ...options,
    blockJS: false,
    blockDangerousJS: true,
  };
}
