import { NextRequest, NextResponse } from 'next/server';
import { compile } from '@mdx-js/mdx';
import filesJson from '../../../../files.json';

// Define type for safety
type FilesJsonType = Record<string, { files: { name: string; content: string; path: string; language: string; type: string; }[] }>;

export async function POST(req: NextRequest) {
  try {
    const { demoId } = await req.json();

    if (!demoId || typeof demoId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid demoId' },
        { status: 400 }
      );
    }

    // Find the demo data in files.json
    const demoData = (filesJson as FilesJsonType)[demoId];
    if (!demoData || !demoData.files) {
        return NextResponse.json(
          { error: `Demo data not found for ${demoId} in files.json` },
          { status: 404 }
        );
    }
    
    // Find the README file (.mdx or .md)
    const readmeFile = demoData.files.find(f => 
        f.name.toLowerCase() === 'readme.mdx' || f.name.toLowerCase() === 'readme.md'
    );

    if (!readmeFile) {
      console.error(`Readme file not found for ${demoId} in files.json`);
      return NextResponse.json(
        { error: `Readme file (.mdx or .md) not found for ${demoId}` },
        { status: 404 }
      );
    }

    const content = readmeFile.content;
    const isMdx = readmeFile.name.toLowerCase().endsWith('.mdx');

    // For MDX files, process them with MDX compiler
    if (isMdx) {
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
    console.error('Error processing MDX request:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
} 