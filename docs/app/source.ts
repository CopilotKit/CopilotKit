import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';
import { icon } from "@/lib/icons";

export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  icon,
});
