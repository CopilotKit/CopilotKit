import { ArrowRight, Star } from "lucide-react";
import { Link } from "react-router";

export const HeroSection = () => {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23f59e0b%22 fill-opacity=%220.03%22%3E%3Ccircle cx=%2230%22 cy=%2230%22 r=%221%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-7xl px-4 py-32 sm:px-6 sm:py-40 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <h1 className="mb-8 text-5xl leading-tight font-extralight tracking-tight text-gray-900 sm:text-6xl lg:text-7xl dark:text-white">
              Step Into
              <span className="block font-light text-amber-600 italic dark:text-amber-500">
                Excellence
              </span>
            </h1>
            <p className="mb-12 text-xl leading-relaxed font-light text-gray-600 sm:text-2xl dark:text-gray-300">
              Discover premium footwear that combines unmatched comfort,
              timeless style, and exceptional craftsmanship.
            </p>
            <div className="flex flex-col gap-6 sm:flex-row">
              <Link
                to="/products"
                className="group flex items-center justify-center bg-amber-600 px-10 py-4 text-lg font-medium tracking-wide text-white transition-all duration-300 hover:bg-amber-700 hover:shadow-lg hover:shadow-amber-600/25"
              >
                Shop Collection
                <ArrowRight className="ml-3 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
              <Link
                to="/about"
                className="border border-gray-300 bg-transparent px-10 py-4 text-center text-lg font-medium tracking-wide text-gray-900 transition-all duration-300 hover:bg-white hover:shadow-lg dark:border-gray-600 dark:text-white dark:hover:bg-gray-800"
              >
                Learn More
              </Link>
            </div>
          </div>
          <div className="relative">
            <img
              src="https://images.pexels.com/photos/2529148/pexels-photo-2529148.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Premium Shoes"
              className="h-auto w-full rounded-lg shadow-2xl"
            />
            <div className="absolute -bottom-6 -left-6 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
              <div className="flex items-center space-x-3">
                <Star className="h-6 w-6 fill-current text-amber-500" />
                <div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    4.9
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Customer Rating
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
