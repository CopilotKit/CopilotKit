export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const KEY_VALUE_REGEX = /\w+="(.*?)"/g;

export const CHARS_REGEX = /\/(.*?)\/((#[a-z])|([\d-,])+)?/g;

export const LINES_REGEX = /\{(.*?)}/g;

export const META_PLACEHOLDER = 'npm2yarn';

export function cleanMetadataParam(metadata: string, param: string): string {
  const regex = new RegExp(
    `${KEY_VALUE_REGEX.source}|${CHARS_REGEX.source}|${LINES_REGEX.source}|${param}`,
    'g',
  );
  return metadata.replace(regex, matched => (matched === param ? '' : matched));
}