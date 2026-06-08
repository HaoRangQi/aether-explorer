import React, { useCallback, useEffect, useRef, useState } from 'react';
import { resolveColumnPathsAfterFileSelection, resolveColumnPathsAfterFolderSelection } from '../../lib/column-navigation';
import { isRemotePath } from '../../lib/path-helpers';
import type { DisplayMode, FileItem } from '../../types';

type SelectionBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type UseExplorerSelectionInput = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentLevelFiles: FileItem[];
  displayMode: DisplayMode;
  navigateToPath: (path: string, options?: { replace?: boolean }) => void;
  onSelectFiles: (ids: string[]) => void;
  selectedFileIds: string[];
  setColumnPaths: React.Dispatch<React.SetStateAction<string[]>>;
  setContextMenu: (value: null) => void;
};

export default function useExplorerSelection({
  containerRef,
  currentLevelFiles,
  displayMode,
  navigateToPath,
  onSelectFiles,
  selectedFileIds,
  setColumnPaths,
  setContextMenu,
}: UseExplorerSelectionInput) {
  const marqueeResetTimerRef = useRef<number | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);

  useEffect(() => () => {
    if (marqueeResetTimerRef.current) {
      window.clearTimeout(marqueeResetTimerRef.current);
      marqueeResetTimerRef.current = null;
    }
  }, []);

  const resetSelectionInteraction = useCallback(() => {
    if (marqueeResetTimerRef.current) {
      window.clearTimeout(marqueeResetTimerRef.current);
      marqueeResetTimerRef.current = null;
    }
    setSelectionBox(null);
    setIsMarqueeDragging(false);
  }, []);

  const handleGlobalMouseUp = useCallback(() => {
    setSelectionBox(null);
    if (marqueeResetTimerRef.current) {
      window.clearTimeout(marqueeResetTimerRef.current);
    }
    marqueeResetTimerRef.current = window.setTimeout(() => {
      setIsMarqueeDragging(false);
      marqueeResetTimerRef.current = null;
    }, 50);
  }, []);

  const handleSelectFile = useCallback((
    file: FileItem,
    event?: React.MouseEvent | React.KeyboardEvent,
    sourceColumnIndex?: number,
  ) => {
    if (event) {
      const isCmd = event.metaKey || event.ctrlKey;
      const isShift = event.shiftKey;

      if (isShift && selectedFileIds.length > 0) {
        const lastId = selectedFileIds[selectedFileIds.length - 1];
        const startIndex = currentLevelFiles.findIndex(candidate => candidate.id === lastId);
        const endIndex = currentLevelFiles.findIndex(candidate => candidate.id === file.id);

        if (startIndex !== -1 && endIndex !== -1) {
          const range = currentLevelFiles
            .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
            .map(candidate => candidate.id);
          const newSelection = Array.from(new Set([...selectedFileIds, ...range]));
          onSelectFiles(newSelection);
        }
      } else if (isCmd) {
        if (selectedFileIds.includes(file.id)) {
          onSelectFiles(selectedFileIds.filter(id => id !== file.id));
        } else {
          onSelectFiles([...selectedFileIds, file.id]);
        }
      } else {
        onSelectFiles([file.id]);
      }
    } else {
      onSelectFiles([file.id]);
    }

    if (displayMode === 'column') {
      if (file.type === 'folder') {
        if (isRemotePath(file.path)) {
          navigateToPath(file.path);
          return;
        }
        setColumnPaths(paths => resolveColumnPathsAfterFolderSelection(paths, file.path, sourceColumnIndex));
      } else {
        setColumnPaths(paths => resolveColumnPathsAfterFileSelection(paths, file.path, sourceColumnIndex));
      }
    }
  }, [currentLevelFiles, displayMode, navigateToPath, onSelectFiles, selectedFileIds, setColumnPaths]);

  const handleContainerMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.file-item')) return;

    setContextMenu(null);
    setIsMarqueeDragging(false);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
  }, [containerRef, setContextMenu]);

  const handleContainerMouseMove = useCallback((event: React.MouseEvent) => {
    if (!selectionBox || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));

    if (!isMarqueeDragging && (Math.abs(x - selectionBox.x1) > 5 || Math.abs(y - selectionBox.y1) > 5)) {
      setIsMarqueeDragging(true);
      if (!event.metaKey && !event.ctrlKey) {
        onSelectFiles([]);
      }
    }

    if (isMarqueeDragging) {
      const newBox = { ...selectionBox, x2: x, y2: y };
      setSelectionBox(newBox);

      const boxRect = {
        left: Math.min(newBox.x1, newBox.x2) + rect.left,
        top: Math.min(newBox.y1, newBox.y2) + rect.top,
        right: Math.max(newBox.x1, newBox.x2) + rect.left,
        bottom: Math.max(newBox.y1, newBox.y2) + rect.top,
      };

      const collidedIds: string[] = [];
      const fileElements = containerRef.current.querySelectorAll('.file-item');
      fileElements.forEach(element => {
        const elementRect = element.getBoundingClientRect();
        const isColliding = !(
          elementRect.right < boxRect.left
          || elementRect.left > boxRect.right
          || elementRect.bottom < boxRect.top
          || elementRect.top > boxRect.bottom
        );
        if (isColliding) {
          collidedIds.push((element as HTMLElement).dataset.id!);
        }
      });

      if (event.metaKey || event.ctrlKey) {
        const combined = Array.from(new Set([...selectedFileIds, ...collidedIds]));
        onSelectFiles(combined);
      } else {
        onSelectFiles(collidedIds);
      }
    }
  }, [containerRef, isMarqueeDragging, onSelectFiles, selectedFileIds, selectionBox]);

  const handleContainerMouseUp = useCallback((_event: React.MouseEvent) => {
    // Selection box clearing handled by global listener
  }, []);

  return {
    handleContainerMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleGlobalMouseUp,
    handleSelectFile,
    isMarqueeDragging,
    resetSelectionInteraction,
    selectionBox,
  };
}
