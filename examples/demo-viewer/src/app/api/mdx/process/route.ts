import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { compile } from '@mdx-js/mdx';

export async function POST(req: NextRequest) {
  try {
    const { filePath } = await req.json();
    
    if (!filePath) {
      return NextResponse.json(
        { error: 'No file path provided' },
        { status: 400 }
      );
    }
    
    // Ensure we're only accessing README files
    if (!filePath.includes('README.mdx') && !filePath.includes('README.md')) {
      return NextResponse.json(
        { error: 'Invalid file path. Only README files are allowed.' },
        { status: 403 }
      );
    }
    
    // Resolve the absolute path
    const fullPath = path.resolve(process.cwd(), filePath);
    
    // Check if the file exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }
    
    // Read the file content
    const content = fs.readFileSync(fullPath, 'utf8');
    
    // For MDX files, process them with MDX compiler
    if (fullPath.endsWith('.mdx')) {
      try {
        // Compile the MDX to JSX
        const result = await compile(content, {
          outputFormat: 'function-body',
          development: process.env.NODE_ENV !== 'production',
        });
        
        return NextResponse.json({ content, compiled: String(result) });
      } catch (error) {
        console.error('Error compiling MDX:', error);
        return NextResponse.json(
          { error: 'Failed to compile MDX', details: String(error) },
          { status: 500 }
        );
      }
    }
    
    // For regular Markdown files, just return the content
    return NextResponse.json({ content });
  } catch (error) {
    console.error('Error processing file:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
} 