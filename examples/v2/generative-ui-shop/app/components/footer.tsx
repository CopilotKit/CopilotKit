import { ShoppingBag } from "lucide-react";
import { Link } from "react-router";

export const Footer = () => {
  return (
    <footer className="border-t border-stone-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-6 flex items-center space-x-3">
              <ShoppingBag className="h-7 w-7 text-amber-600 dark:text-amber-500" />
              <span className="text-xl font-light tracking-wide text-gray-900 dark:text-white">
                EpicStore
              </span>
            </div>
            <p className="max-w-md leading-relaxed font-light text-gray-600 dark:text-gray-400">
              Your premier destination for premium epic products. Discover the
              perfect product that combines style, comfort, and quality
              craftsmanship.
            </p>
          </div>
          <div>
            <h3 className="mb-6 text-sm font-medium tracking-wider text-gray-900 uppercase dark:text-white">
              Shop
            </h3>
            <ul className="space-y-4">
              <li>
                <Link
                  to="/products"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  All Products
                </Link>
              </li>
              <li>
                <Link
                  to="/products?category=Running"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  Running
                </Link>
              </li>
              <li>
                <Link
                  to="/products?category=Casual"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  Casual
                </Link>
              </li>
              <li>
                <Link
                  to="/products?category=Formal"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  Formal
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-6 text-sm font-medium tracking-wider text-gray-900 uppercase dark:text-white">
              Company
            </h3>
            <ul className="space-y-4">
              <li>
                <Link
                  to="/about"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  to="/contact"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link
                  to="/terms-of-service"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  to="/terms-of-use"
                  className="font-light text-gray-600 transition-colors duration-300 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-500"
                >
                  Terms of Use
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-stone-200 pt-8 dark:border-gray-700">
          <p className="text-center font-light text-gray-500 dark:text-gray-400">
            © 2025 EpicStore. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
