export const NewsletterSection = () => {
  return (
    <div className="bg-gradient-to-r from-gray-900 to-gray-800 py-24 dark:from-gray-800 dark:to-gray-900">
      <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="mb-6 text-4xl font-extralight tracking-tight text-white">
          Stay in the Loop
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed font-light text-gray-300">
          Be the first to know about new arrivals, exclusive offers, and style
          tips.
        </p>
        <div className="mx-auto flex max-w-md">
          <input
            type="email"
            placeholder="Enter your email"
            className="flex-1 rounded-l-lg bg-white px-6 py-4 text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
          />
          <button className="rounded-r-lg bg-amber-600 px-8 py-4 font-medium text-white transition-colors duration-300 hover:bg-amber-700">
            Subscribe
          </button>
        </div>
      </div>
    </div>
  );
};
