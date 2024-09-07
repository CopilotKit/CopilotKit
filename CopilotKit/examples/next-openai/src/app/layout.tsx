import "../styles/globals.css";
import "@copilotkit-alt/react-ui/styles.css";
import "@copilotkit-alt/react-textarea/styles.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-zinc-900">
      <body>{children}</body>
    </html>
  );
}
