import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Icons | A2UI Composer',
};

export default function IconsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
