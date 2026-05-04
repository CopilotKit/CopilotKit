export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
