import { Metadata } from 'next';
import { CreateWidget } from '@/components/main/create-widget';

export const metadata: Metadata = {
  title: 'Create | A2UI Composer',
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-32">
      <CreateWidget />
    </div>
  );
}
