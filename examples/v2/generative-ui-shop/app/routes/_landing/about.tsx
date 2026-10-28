import { Award, Heart, Compass, Lightbulb } from "lucide-react";

export default function AboutPage() {
  const team = [
    {
      name: "Marcus Rodriguez",
      role: "Founder & CEO",
      image:
        "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=400",
      bio: "Passionate about bringing premium footwear to everyone with 15+ years in fashion retail.",
    },
    {
      name: "Elena Chen",
      role: "Head of Design",
      image:
        "https://images.pexels.com/photos/1181686/pexels-photo-1181686.jpeg?auto=compress&cs=tinysrgb&w=400",
      bio: "Former Nike designer with expertise in creating comfortable and stylish footwear.",
    },
    {
      name: "Sofia Laurent",
      role: "Customer Experience Director",
      image:
        "https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=400",
      bio: "Dedicated to ensuring every customer finds their perfect pair of shoes.",
    },
  ];

  const values = [
    {
      icon: <Lightbulb className="h-8 w-8" />,
      title: "Innovation",
      description:
        "We constantly seek new materials and technologies to improve comfort and style.",
    },
    {
      icon: <Heart className="h-8 w-8" />,
      title: "Passion",
      description:
        "Every shoe is selected with genuine care for quality and customer satisfaction.",
    },
    {
      icon: <Award className="h-8 w-8" />,
      title: "Quality",
      description:
        "We partner only with brands that meet our high standards for craftsmanship.",
    },
    {
      icon: <Compass className="h-8 w-8" />,
      title: "Purpose",
      description:
        "Helping people step confidently into their daily adventures.",
    },
  ];

  return (
    <div className="bg-stone-50 dark:bg-gray-900">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 py-32 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="mb-8 text-5xl font-extralight tracking-tight text-gray-900 sm:text-6xl dark:text-white">
            Our Story
          </h1>
          <p className="mx-auto max-w-4xl text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
            Born from a passion for exceptional footwear and a vision to make
            premium shoes accessible to everyone who values quality, comfort,
            and style.
          </p>
        </div>
      </div>

      {/* Story Section */}
      <div className="bg-white py-32 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-20 lg:grid-cols-2">
            <div>
              <h2 className="mb-8 text-4xl font-extralight tracking-tight text-gray-900 dark:text-white">
                Walking Together Since 2020
              </h2>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                EpicStore was founded on the belief that everyone deserves
                access to premium footwear that doesn't compromise on comfort,
                style, or quality. We started as a small team of shoe
                enthusiasts who were frustrated by the lack of truly exceptional
                options in the market.
              </p>
              <p className="mb-6 text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                What began as weekend trips to discover hidden gem shoe
                manufacturers has evolved into a curated marketplace that
                connects customers with the world's finest footwear brands, from
                established names to emerging designers.
              </p>
              <p className="text-lg leading-relaxed font-light text-gray-600 dark:text-gray-300">
                Today, we're proud to serve thousands of customers who trust us
                to help them find shoes that not only look great but feel
                amazing and last for years to come.
              </p>
            </div>
            <div className="group relative">
              <img
                src="https://images.pexels.com/photos/1598508/pexels-photo-1598508.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Shoe craftsmanship"
                className="group-hover:shadow-3xl shadow-2xl transition-all duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-amber-600/20 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            </div>
          </div>
        </div>
      </div>

      {/* Values Section */}
      <div className="bg-stone-50 py-32 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-20 text-center">
            <h2 className="mb-6 text-4xl font-extralight tracking-tight text-gray-900 dark:text-white">
              Our Values
            </h2>
            <p className="mx-auto max-w-3xl text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
              These principles guide every decision we make and every
              relationship we build.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
            {values.map((value, index) => (
              <div
                key={index}
                className="group bg-white p-10 text-center transition-all duration-300 hover:scale-105 hover:transform hover:shadow-lg dark:bg-gray-900"
              >
                <div className="mb-6 flex justify-center text-amber-600 transition-transform duration-300 group-hover:scale-110 dark:text-amber-500">
                  {value.icon}
                </div>
                <h3 className="mb-4 text-xl font-light tracking-wide text-gray-900 dark:text-white">
                  {value.title}
                </h3>
                <p className="leading-relaxed font-light text-gray-600 dark:text-gray-300">
                  {value.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team Section */}
      <div className="bg-white py-32 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-20 text-center">
            <h2 className="mb-6 text-4xl font-extralight tracking-tight text-gray-900 dark:text-white">
              Meet Our Team
            </h2>
            <p className="mx-auto max-w-3xl text-xl leading-relaxed font-light text-gray-600 dark:text-gray-300">
              The passionate individuals who make EpicStore a destination for
              shoe lovers everywhere.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
            {team.map((member, index) => (
              <div
                key={index}
                className="group text-center transition-all duration-300 hover:scale-105 hover:transform"
              >
                <div className="relative mb-8 overflow-hidden">
                  <img
                    src={member.image}
                    alt={member.name}
                    className="h-80 w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-amber-600/30 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                </div>
                <h3 className="mb-2 text-2xl font-light tracking-wide text-gray-900 dark:text-white">
                  {member.name}
                </h3>
                <p className="mb-4 font-light tracking-wide text-amber-600 dark:text-amber-500">
                  {member.role}
                </p>
                <p className="leading-relaxed font-light text-gray-600 dark:text-gray-300">
                  {member.bio}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mission Section */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 py-24 dark:from-gray-800 dark:to-gray-900">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="mb-8 text-4xl font-extralight tracking-tight text-white">
            Our Mission
          </h2>
          <p className="mx-auto max-w-4xl text-xl leading-relaxed font-light text-gray-300">
            To provide exceptional footwear that empowers people to step
            confidently into their daily adventures, combining unmatched comfort
            with timeless style and sustainable practices.
          </p>
        </div>
      </div>
    </div>
  );
}
