import { Outlet } from "react-router";
import { Footer } from "#app/components/footer";
import { Header } from "#app/components/header";
import { ShopAssistant } from "#app/components/shop-assistant";

export default function LayoutPage() {
  return (
    <div className="min-h-screen bg-stone-50 transition-colors duration-300 dark:bg-gray-900">
      <Header />
      <main className="flex-grow">
        <Outlet />
      </main>
      <Footer />
      <ShopAssistant />
    </div>
  );
}
