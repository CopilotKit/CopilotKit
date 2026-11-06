import { useState, useEffect, useCallback } from "react";
import { useFetcher, useSearchParams, href } from "react-router";
import type { Route } from "../../+types/index";

export function useInfiniteProductFetcher(
  loaderData: Route.ComponentProps["loaderData"],
) {
  const fetcher = useFetcher<Route.ComponentProps["loaderData"]>({
    key: "infinite-product-fetcher",
  });
  const { products, pagination } = loaderData;
  const [allProducts, setAllProducts] = useState(products);
  const [currentPage, setCurrentPage] = useState(pagination.page);
  const [hasMore, setHasMore] = useState(pagination.hasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchParams] = useSearchParams();
  useEffect(
    function resetStateOnLoaderRefire() {
      setAllProducts(products);
      setCurrentPage(pagination.page);
      setHasMore(pagination.hasMore);
    },
    [pagination.hasMore, pagination.page, products],
  );

  useEffect(
    function setNewlyLoadedProducts() {
      if (fetcher.data && fetcher.state === "idle" && isLoadingMore) {
        setAllProducts((prev) => [...prev, ...(fetcher.data?.products ?? [])]);
        setCurrentPage(fetcher.data.pagination.page);
        setHasMore(fetcher.data.pagination.hasMore);
        setIsLoadingMore(false);
      }
    },
    [fetcher.data, fetcher.state, isLoadingMore],
  );

  const loadMoreProducts = useCallback(() => {
    setIsLoadingMore(true);
    const nextPage = currentPage + 1;

    // Create URL params for the fetch
    const params = new URLSearchParams(searchParams);
    params.set("page", nextPage.toString());

    void fetcher.load(href("/products") + "?" + params.toString());
  }, [currentPage, fetcher, searchParams]);

  return { fetcher, loadMoreProducts, allProducts, hasMore, isLoadingMore };
}
