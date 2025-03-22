import { NextResponse } from 'next/server';
import { posts } from '@/app/lib/data/data';

export async function GET() {
  return NextResponse.json(posts);
}
