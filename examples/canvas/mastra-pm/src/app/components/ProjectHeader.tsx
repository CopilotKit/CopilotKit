export function ProjectHeader({ name, description }: { name: string, description: string }) {
  return (
    <div className="flex justify-between items-center p-8 border-b border-white/10">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{name}</h1>
        <p className="text-gray-200 text-sm">{description}</p>
      </div>
    </div>
  );
} 