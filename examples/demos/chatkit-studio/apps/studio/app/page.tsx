export default function Home() {
  const apps = [
    {
      title: "Playground",
      description: "Customize & learn",
      icon: "📱",
      url: process.env.PLAYGROUND_URL || "http://localhost:3001",
      gradient: "from-purple-500 to-pink-500",
    },
    {
      title: "chatkit.world",
      description: "See a demo",
      icon: "🌍",
      url: process.env.WORLD_URL || "http://localhost:3002",
      gradient: "from-emerald-500 to-teal-500",
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center p-8">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            ChatKit Studio
          </h1>
          <p className="text-xl text-gray-600">
            Explore and build embeddable chat experiences
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {apps.map((app) => (
            <a
              key={app.title}
              href={app.url}
              className={`group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden`}
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${app.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}
              />
              <div className="relative p-8 flex flex-col items-center text-center h-full">
                <div
                  className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${app.gradient} flex items-center justify-center text-4xl mb-6 group-hover:scale-110 transition-transform duration-300`}
                >
                  {app.icon}
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {app.title}
                </h2>
                <p className="text-gray-600">{app.description}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
