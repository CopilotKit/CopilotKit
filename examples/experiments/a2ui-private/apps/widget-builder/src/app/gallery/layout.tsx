import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Gallery | A2UI Composer',
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
