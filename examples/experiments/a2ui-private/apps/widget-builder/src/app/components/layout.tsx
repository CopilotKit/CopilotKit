import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Components | A2UI Composer',
};

export default function ComponentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
