import React from 'react';
import type { TFunction } from 'i18next';
import { AnimatePresence, motion } from 'motion/react';
import type { FileItem } from '../../types';
import type {
  DragPreviewState,
  ExistingOutputChoice,
  ExistingOutputDialogState,
  MoveConflictChoice,
  MoveConflictDialogState,
} from './explorer-types';

type ExplorerOverlaysProps = {
  dragOverFolderId: string | null;
  dragPreview: DragPreviewState | null;
  existingOutputDialog: ExistingOutputDialogState | null;
  findFileById: (id: string) => FileItem | undefined;
  getFileIcon: (target: FileItem | FileItem['type'], thumbnailOverride?: string) => React.ReactNode;
  handleExistingOutputChoice: (choice: ExistingOutputChoice) => void;
  handleMoveConflictChoice: (choice: MoveConflictChoice) => void | Promise<void>;
  moveConflictDialog: MoveConflictDialogState | null;
  operationMessage: string;
  t: TFunction;
};

export default function ExplorerOverlays({
  dragOverFolderId,
  dragPreview,
  existingOutputDialog,
  findFileById,
  getFileIcon,
  handleExistingOutputChoice,
  handleMoveConflictChoice,
  moveConflictDialog,
  operationMessage,
  t,
}: ExplorerOverlaysProps) {
  const dragPreviewFile = dragPreview?.active ? findFileById(dragPreview.fileId) : undefined;
  const targetFolder = dragOverFolderId ? findFileById(dragOverFolderId) : null;
  const dragPreviewLabel = dragPreview && dragPreview.count > 1
    ? t('explorer.items', { count: dragPreview.count, defaultValue: `${dragPreview.count} items` })
    : dragPreviewFile?.name;

  return (
    <>
      <AnimatePresence>
        {operationMessage && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[120] px-5 py-3 rounded-2xl bg-primary text-on-primary text-[13px] font-black shadow-2xl shadow-primary/20 max-w-[70vw] truncate"
          >
            {operationMessage}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {existingOutputDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border border-primary/25 bg-surface/95 p-5 shadow-2xl shadow-black/30"
            >
              <h3 className="text-[17px] font-black text-on-surface">
                {t('dialogs.outputExistsTitle', '目标已存在')}
              </h3>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-on-surface/65">
                {t('dialogs.outputExistsDescription', {
                  name: existingOutputDialog.name,
                  type: existingOutputDialog.kind === 'archive'
                    ? t('explorer.archive', '压缩包')
                    : t('explorer.folder', '文件夹'),
                  defaultValue: '“{{name}}” 已存在。请选择替换现有{{type}}，或自动创建一个新名称。',
                })}
              </p>
              <div className="mt-4 rounded-xl border border-primary/10 bg-primary/5 p-3">
                <p className="text-[10px] font-black uppercase text-on-surface/35">
                  {t('dialogs.outputPath', '目标路径')}
                </p>
                <p className="mt-1 break-all font-mono text-[12px] font-bold text-on-surface/70">
                  {existingOutputDialog.path}
                </p>
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => handleExistingOutputChoice('cancel')}
                  className="rounded-xl px-4 py-2.5 text-[13px] font-black text-on-surface/65 transition-colors hover:bg-primary/10"
                >
                  {t('dialogs.cancel', '取消')}
                </button>
                <button
                  onClick={() => handleExistingOutputChoice('keepBoth')}
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-2.5 text-[13px] font-black text-on-surface transition-colors hover:bg-primary/20"
                >
                  {t('dialogs.keepBoth', '保留两者')}
                </button>
                <button
                  onClick={() => handleExistingOutputChoice('replace')}
                  className="rounded-xl bg-red-500 px-4 py-2.5 text-[13px] font-black text-white shadow-lg shadow-red-500/20 transition-transform active:scale-95"
                >
                  {t('dialogs.replaceExisting', '替换')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {moveConflictDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border border-primary/25 bg-surface/95 p-5 shadow-2xl shadow-black/30"
            >
              <h3 className="text-[17px] font-black text-on-surface">
                {t('dialogs.moveConflictTitle', '目标中已有同名项目')}
              </h3>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-on-surface/65">
                {moveConflictDialog.conflicts.length === 1
                  ? t('dialogs.moveConflictDescription', {
                    name: moveConflictDialog.conflicts[0].name,
                    folder: moveConflictDialog.targetFolder.name,
                  })
                  : t('dialogs.moveConflictDescriptionMultiple', {
                    count: moveConflictDialog.conflicts.length,
                    folder: moveConflictDialog.targetFolder.name,
                  })}
              </p>
              <div className="mt-4 max-h-36 overflow-y-auto rounded-xl border border-primary/10 bg-primary/5 p-2">
                {moveConflictDialog.conflicts.slice(0, 6).map(conflict => (
                  <div key={`${conflict.src}-${conflict.dst}`} className="truncate px-2 py-1 text-[12px] font-bold text-on-surface/70">
                    {conflict.name}
                  </div>
                ))}
                {moveConflictDialog.conflicts.length > 6 && (
                  <div className="px-2 py-1 text-[12px] font-bold text-on-surface/40">
                    +{moveConflictDialog.conflicts.length - 6}
                  </div>
                )}
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => handleMoveConflictChoice('cancel')}
                  className="rounded-xl px-4 py-2.5 text-[13px] font-black text-on-surface/65 transition-colors hover:bg-primary/10"
                >
                  {t('dialogs.cancel', '取消')}
                </button>
                <button
                  onClick={() => handleMoveConflictChoice('keepBoth')}
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-2.5 text-[13px] font-black text-on-surface transition-colors hover:bg-primary/20"
                >
                  {t('dialogs.keepBoth', '保留两者')}
                </button>
                <button
                  onClick={() => handleMoveConflictChoice('skip')}
                  className="rounded-xl border border-primary/20 bg-surface px-4 py-2.5 text-[13px] font-black text-on-surface transition-colors hover:bg-primary/10"
                >
                  {t('dialogs.skipExisting', '跳过')}
                </button>
                <button
                  onClick={() => handleMoveConflictChoice('replace')}
                  className="rounded-xl bg-red-500 px-4 py-2.5 text-[13px] font-black text-white shadow-lg shadow-red-500/20 transition-transform active:scale-95"
                >
                  {t('dialogs.replaceExisting', '替换')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dragPreview?.active && dragPreviewFile && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.12 }}
            className="fixed z-[130] pointer-events-none flex max-w-[320px] items-center gap-3 rounded-xl border border-primary/35 bg-surface/95 px-3 py-2 shadow-2xl shadow-black/25 backdrop-blur-xl"
            style={{
              left: dragPreview.x + 14,
              top: dragPreview.y + 14,
            }}
          >
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              {getFileIcon(dragPreviewFile)}
              {dragPreview.count > 1 && (
                <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-black text-on-primary shadow-lg">
                  {dragPreview.count}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-black text-on-surface">{dragPreviewLabel}</div>
              <div className="truncate text-[11px] font-bold text-on-surface/55">
                {targetFolder?.type === 'folder' ? targetFolder.name : t('explorer.folder', '文件夹')}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
