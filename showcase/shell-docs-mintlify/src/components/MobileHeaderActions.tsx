import { Icon } from "@mintlify/components";

/**
 * Hamburger that opens the mobile sidebar drawer. The drawer (MobileSidebar)
 * listens for the `toggle-mobile-sidebar` custom event.
 */
export function MobileMenuButton() {
  const handleToggle = () => {
    window.dispatchEvent(new CustomEvent("toggle-mobile-sidebar"));
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="Open navigation"
      className="flex lg:hidden items-center justify-center w-9 h-9 rounded-[0.85rem] text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <Icon icon="menu" iconLibrary="lucide" size={18} color="currentColor" />
    </button>
  );
}
