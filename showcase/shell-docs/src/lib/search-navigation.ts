interface SearchNavigation {
  push: (href: string) => void;
  assign: (href: string) => void;
}

export function navigateToSearchHref(
  href: string,
  navigation: SearchNavigation,
) {
  const external =
    /^(https?:)?\/\//i.test(href) || /^(mailto|tel|ftp|ftps):/i.test(href);
  if (external) navigation.assign(href);
  else navigation.push(href);
}
