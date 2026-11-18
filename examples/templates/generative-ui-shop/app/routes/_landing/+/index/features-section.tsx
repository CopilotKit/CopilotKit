import { Truck, Shield, RefreshCw, Award } from "lucide-react";

const features = [
  {
    icon: <Truck className="h-6 w-6" />,
    title: "Free Shipping",
    description: "Free shipping on orders over $75",
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Secure Payment",
    description: "100% secure payment processing",
  },
  {
    icon: <RefreshCw className="h-6 w-6" />,
    title: "Easy Returns",
    description: "30-day hassle-free returns",
  },
  {
    icon: <Award className="h-6 w-6" />,
    title: "Quality Guarantee",
    description: "Premium quality assurance",
  },
];

export const FeaturesSection = () => {
  return (
    <div className="bg-white py-20 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group text-center transition-all duration-300 hover:scale-105 hover:transform"
            >
              <div className="mb-4 flex justify-center text-amber-600 transition-transform duration-300 group-hover:scale-110 dark:text-amber-500">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-lg font-medium tracking-wide text-gray-900 dark:text-white">
                {feature.title}
              </h3>
              <p className="font-light text-gray-600 dark:text-gray-300">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
