import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { RizzchartsMarkdownRendererService } from './markdown-renderer.service';

describe('RizzchartsMarkdownRendererService', () => {
  let service: RizzchartsMarkdownRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RizzchartsMarkdownRendererService,
        {
          provide: DomSanitizer,
          useValue: {
            bypassSecurityTrustHtml: (val: string) => val,
          },
        },
      ],
    });
    service = TestBed.inject(RizzchartsMarkdownRendererService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should render markdown to html', async () => {
    const markdown = '**bold**';
    const result = await service.render(markdown);
    expect(result).toContain('<strong>bold</strong>');
  });

  it('should open links in new tab', async () => {
    const markdown = '[link](http://example.com)';
    const result = await service.render(markdown);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });
});
