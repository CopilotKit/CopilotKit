import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { FileEntry } from '@/components/file-tree/file-tree';

export async function POST(request: Request) {
  try {
    const { path } = await request.json();
    
    const absolutePath = join(process.cwd(), path);
    const content = await readFile(absolutePath, 'utf-8');
    
    return NextResponse.json({ content });
  } catch (error) {
    console.error('Error reading file:', error);
    return NextResponse.json(
      { error: 'Failed to read file' },
      { status: 500 }
    );
  }
} 