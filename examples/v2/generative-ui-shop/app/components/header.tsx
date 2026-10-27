import { ShoppingBag, Search, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, Form, useSearchParams } from "react-router";
import { CartButton } from "./cart-button";
import { CompareButton } from "./compare-button";

export const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigation = [
    { name: "Home", href: "/" },
    { name: "Products", href: "/products" },
    { name: "About", href: "/about" },
    { name: "Contact", href: "/contact" },
  ];
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isActive = (href: string) => location.pathname === href;
  const q = searchParams.get("q") || "";
  return (
    <nav className="sticky top-0 z-50 border-b pr-16 border-stone-200 bg-white/95 backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/95">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-3">
              <ShoppingBag className="h-8 w-8 text-amber-600 dark:text-amber-500" />
              <span className="text-2xl font-light tracking-wide text-gray-900 dark:text-white">
                EpicStore
              </span>
            </Link>
          </div>

          <div className="mx-8 hidden max-w-lg flex-1 md:block">
            <div className="relative">
              <Form method="GET" action="/products" className="relative">
                <Search className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-gray-400" />
                <input
                  type="text"
                  defaultValue={q}
                  name="q"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const form = e.currentTarget.form;
                      if (form) {
                        form.submit();
                      }
                    }
                  }}
                  placeholder="Search for products..."
                  className="w-full rounded-full border border-gray-200 bg-gray-50 py-3 pr-24 pl-10 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <button
                  type="submit"
                  className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center space-x-1 rounded-full bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-300 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  <Search className="h-4 w-4" />
                  <span>Search</span>
                </button>
              </Form>
            </div>
          </div>

          <div className="hidden md:block">
            <div className="flex items-center space-x-8">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`text-sm font-medium tracking-wide transition-colors duration-300 ${
                    isActive(item.href)
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-gray-700 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-500"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
              <CompareButton />
              <CartButton />
            </div>
          </div>

          <div className="flex items-center space-x-2 md:hidden">
            <CompareButton />
            <CartButton />
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 text-gray-700 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-500"
            >
              {isMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden">
          <div className="space-y-4 border-t border-stone-200 bg-white px-4 pt-2 pb-6 dark:border-gray-700 dark:bg-gray-900">
            <div className="relative mb-4">
              <Search className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-gray-400" />
              <input
                type="text"
                placeholder="Search for products..."
                className="w-full rounded-full border border-gray-200 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsMenuOpen(false)}
                className={`block text-base font-medium tracking-wide transition-colors duration-300 ${
                  isActive(item.href)
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-gray-700 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-500"
                }`}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};
