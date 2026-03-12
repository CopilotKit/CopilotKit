'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { A2UIViewer } from '@copilotkitnext/a2ui-renderer';

// 100 most important Material Icons for common UI patterns
const MATERIAL_ICONS = [
  // Navigation & Actions
  'home', 'menu', 'close', 'arrow_back', 'arrow_forward', 'chevron_left', 'chevron_right',
  'expand_more', 'expand_less', 'more_vert', 'more_horiz', 'refresh', 'search', 'settings',

  // Common Actions
  'add', 'remove', 'edit', 'delete', 'save', 'done', 'check', 'check_circle', 'cancel',
  'send', 'share', 'download', 'upload', 'print', 'copy', 'content_paste',

  // Communication
  'mail', 'email', 'message', 'chat', 'phone', 'call', 'notifications', 'notification_important',

  // Media
  'play_arrow', 'pause', 'stop', 'skip_next', 'skip_previous', 'volume_up', 'volume_off',
  'mic', 'videocam', 'photo_camera', 'image', 'music_note',

  // People & Account
  'person', 'people', 'group', 'account_circle', 'face', 'sentiment_satisfied',

  // Status & Info
  'info', 'help', 'warning', 'error', 'error_outline', 'report', 'verified',
  'star', 'star_border', 'favorite', 'favorite_border', 'thumb_up', 'thumb_down',

  // Content & Files
  'folder', 'folder_open', 'file_copy', 'description', 'article', 'note', 'attachment',
  'link', 'insert_link', 'cloud', 'cloud_upload', 'cloud_download',

  // Time & Date
  'schedule', 'access_time', 'today', 'event', 'calendar_today', 'alarm',

  // Location
  'place', 'location_on', 'map', 'directions', 'navigation', 'near_me',

  // Shopping & Commerce
  'shopping_cart', 'add_shopping_cart', 'store', 'payment', 'credit_card', 'receipt',

  // Device & Hardware
  'smartphone', 'laptop', 'desktop_windows', 'keyboard', 'mouse', 'bluetooth', 'wifi',

  // Misc UI
  'visibility', 'visibility_off', 'lock', 'lock_open', 'key', 'security',
  'dashboard', 'list', 'view_list', 'grid_view', 'table_chart', 'bar_chart',
];

function IconCard({ name, isSelected, onClick }: { name: string; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors',
        isSelected
          ? 'border-foreground bg-muted'
          : 'border-border bg-white hover:border-muted-foreground/30'
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center scale-[2]">
        <A2UIViewer
          root="icon"
          components={[
            {
              id: 'icon',
              component: {
                Icon: {
                  name: { literalString: name },
                },
              },
            },
          ]}
        />
      </div>
      <span className="text-xs text-muted-foreground truncate w-full text-center">
        {name}
      </span>
    </button>
  );
}

export default function IconsPage() {
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (name: string) => {
    const code = `{ "Icon": { "name": { "literalString": "${name}" } } }`;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Icons</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A2UI uses Material Icons. Showing 100 most commonly used icons.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {selectedIcon && (
            <button
              onClick={() => handleCopy(selectedIcon)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy "{selectedIcon}"
                </>
              )}
            </button>
          )}
          <a
            href="https://fonts.google.com/icons"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Browse all icons
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
        {MATERIAL_ICONS.map((name) => (
          <IconCard
            key={name}
            name={name}
            isSelected={selectedIcon === name}
            onClick={() => setSelectedIcon(name)}
          />
        ))}
      </div>
    </div>
  );
}
