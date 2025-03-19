import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  // Get the path from URL params
  const searchParams = request.nextUrl.searchParams;
  const demoId = searchParams.get('demoId');
  const fileName = searchParams.get('fileName');
  
  if (!demoId || !fileName) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    );
  }
  
  // Construct the file path to where the demo CSS files actually live
  const basePath = path.resolve(process.cwd());
  const filePath = path.join(basePath, 'agent', 'demo', demoId, fileName);
  
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }
    
    // Read the file
    const fileContent = fs.readFileSync(filePath);
    
    // Determine content type based on file extension
    let contentType = 'text/plain';
    if (fileName.endsWith('.css')) {
      contentType = 'text/css';
    } else if (fileName.endsWith('.js')) {
      contentType = 'application/javascript';
    } else if (fileName.endsWith('.json')) {
      contentType = 'application/json';
    }
    
    // Return the file contents with appropriate content type
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error serving file:', error);
    return NextResponse.json(
      { error: 'Failed to serve file' },
      { status: 500 }
    );
  }
} 