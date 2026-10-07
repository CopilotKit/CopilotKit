/* eslint-disable react-hooks/immutability -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { motion } from 'motion/react';
import { useWorkspaceEntranceMotion } from './workspace-entrance';
import {
  ArrowDownWideNarrow,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { SearchField } from '../ui/forms';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '../ui/overlays';
import { Button } from '../ui/primitives';
import styles from './workspace-collection-toolbar.module.css';

export interface WorkspaceCollectionToolbarProps {
  readonly label: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => void;
  readonly refreshing?: boolean;
  /** Secondary control such as a server-backed owner picker. */
  readonly auxiliary?: ReactNode;
  readonly maxQueryLength?: number;
  readonly filter?: ReactNode;
  readonly sort?: ReactNode;
  /** Lets a disappearing empty-state action return focus to the stable search. */
  readonly searchInputRef?: RefObject<HTMLInputElement | null>;
  /** Make limited server search fields explicit instead of implying all columns. */
  readonly searchPlaceholder?: string;
}

/** Keeps collection search and options consistent without owning server data. */
export function WorkspaceCollectionToolbar(
  props: WorkspaceCollectionToolbarProps,
): React.JSX.Element {
  const searchRef = useRef<HTMLInputElement>(null);
  const entrance = useWorkspaceEntranceMotion(1);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      if (
        event.key !== '/' ||
        // A decorative copy, such as an onboarding preview, cannot take focus.
        searchRef.current?.closest('[inert]') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable ||
        document.querySelector(
          '[role="dialog"], [role="menu"], [data-slot="popover-content"][data-state="open"]',
        )
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <motion.div className={styles.toolbar} role="search" {...entrance}>
      <SearchField
        aria-label={`Search ${props.label}`}
        className={styles.search}
        maxLength={props.maxQueryLength}
        onChange={(event) => props.onQueryChange(event.target.value)}
        placeholder={props.searchPlaceholder ?? `Search ${props.label}…`}
        ref={(node) => {
          searchRef.current = node;
          if (props.searchInputRef) props.searchInputRef.current = node;
        }}
        shortcut="/"
        value={props.query}
      />
      {props.auxiliary ? (
        <div className={styles.auxiliary}>{props.auxiliary}</div>
      ) : null}
      {props.filter ? (
        <div className={styles.desktop}>
          <MenuRoot modal={false}>
            <MenuTrigger asChild>
              <Button
                aria-label={`Filter ${props.label}`}
                size="icon"
                variant="outline"
              >
                <SlidersHorizontal aria-hidden="true" size={16} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" aria-label={`Filter ${props.label}`}>
              <MenuLabel>Filter</MenuLabel>
              {props.filter}
            </MenuContent>
          </MenuRoot>
        </div>
      ) : null}
      {props.sort ? (
        <div className={styles.desktop}>
          <MenuRoot modal={false}>
            <MenuTrigger asChild>
              <Button
                aria-label={`Sort ${props.label}`}
                size="icon"
                variant="outline"
              >
                <ArrowDownWideNarrow aria-hidden="true" size={16} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" aria-label={`Sort ${props.label}`}>
              <MenuLabel>Sort</MenuLabel>
              {props.sort}
            </MenuContent>
          </MenuRoot>
        </div>
      ) : null}
      <Button
        aria-label={`Refresh ${props.label}`}
        className={styles.desktop}
        disabled={props.refreshing}
        onClick={props.onRefresh}
        size="icon"
        variant="outline"
      >
        <RefreshCw aria-hidden="true" size={16} />
      </Button>
      <div className={styles.mobile}>
        <MenuRoot modal={false}>
          <MenuTrigger asChild>
            <Button
              aria-label={`${props.label} options`}
              size="icon"
              variant="outline"
            >
              <MoreHorizontal aria-hidden="true" size={16} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" aria-label={`${props.label} options`}>
            {props.filter ? (
              <>
                <MenuLabel>Filter</MenuLabel>
                {props.filter}
                <MenuSeparator />
              </>
            ) : null}
            {props.sort ? (
              <>
                <MenuLabel>Sort</MenuLabel>
                {props.sort}
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem disabled={props.refreshing} onSelect={props.onRefresh}>
              <RefreshCw aria-hidden="true" size={15} />
              Refresh {props.label}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>
    </motion.div>
  );
}
