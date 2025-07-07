import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';
import { icon } from '@/media/icons';

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  icon: icon,
});
