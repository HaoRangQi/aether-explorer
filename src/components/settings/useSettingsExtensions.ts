import { useState } from 'react';
import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';
import type { TFunction } from 'i18next';
import type { ContextMenuAction, ThemeSettings } from '../../types';

type UseSettingsExtensionsArgs = {
  t: TFunction;
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
};

export function useSettingsExtensions({
  t,
  theme,
  onThemeChange,
}: UseSettingsExtensionsArgs) {
  const [newActionLabel, setNewActionLabel] = useState('');
  const [newActionType, setNewActionType] = useState<NonNullable<ContextMenuAction['actionType']>>('terminal');
  const [newTerminalApp, setNewTerminalApp] = useState(theme.terminalApp || 'Terminal');
  const [newTerminalArgs, setNewTerminalArgs] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newUrlTemplate, setNewUrlTemplate] = useState('');
  const [newWorkingDirectory, setNewWorkingDirectory] = useState<'selection' | 'current'>('selection');
  const [editingExtensionId, setEditingExtensionId] = useState<string | null>(null);

  const resetActionForm = () => {
    setEditingExtensionId(null);
    setNewActionLabel('');
    setNewActionType('terminal');
    setNewTerminalApp(theme.terminalApp || 'Terminal');
    setNewTerminalArgs('');
    setNewCommand('');
    setNewUrlTemplate('');
    setNewWorkingDirectory('selection');
  };

  const populateActionForm = (extension: ContextMenuAction) => {
    setEditingExtensionId(extension.id);
    setNewActionLabel(extension.label);
    setNewActionType(extension.actionType || 'placeholder');
    setNewTerminalApp(extension.terminalApp || theme.terminalApp || 'Terminal');
    setNewTerminalArgs(extension.terminalArgs || '');
    setNewCommand(extension.command || '');
    setNewUrlTemplate(extension.urlTemplate || '');
    setNewWorkingDirectory(extension.workingDirectory || 'selection');
  };

  const toggleExtension = (id: string) => {
    const extensions = theme.contextMenuExtensions || [];
    onThemeChange({
      ...theme,
      contextMenuExtensions: extensions.map(extension => (
        extension.id === id ? { ...extension, enabled: !extension.enabled } : extension
      )),
    });
  };

  const isNewActionValid = () => {
    if (!newActionLabel.trim()) return false;
    if (newActionType === 'shell') return Boolean(newCommand.trim());
    if (newActionType === 'url') return Boolean(newUrlTemplate.trim());
    return true;
  };

  const updateExtension = () => {
    if (!editingExtensionId || !isNewActionValid()) return;
    const extensions = theme.contextMenuExtensions || [];
    const nextExtensions = extensions.map(extension => {
      if (extension.id !== editingExtensionId) return extension;
      const updated: ContextMenuAction = {
        ...extension,
        label: newActionLabel.trim(),
        actionType: newActionType,
        workingDirectory: newWorkingDirectory,
        confirmExecution: extension.confirmExecution ?? true,
      };
      delete updated.terminalApp;
      delete updated.terminalArgs;
      delete updated.command;
      delete updated.urlTemplate;
      if (newActionType === 'terminal') {
        updated.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
        updated.terminalArgs = newTerminalArgs.trim();
      }
      if (newActionType === 'shell') {
        updated.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
        updated.command = newCommand.trim();
      }
      if (newActionType === 'url') {
        updated.urlTemplate = newUrlTemplate.trim();
      }
      return updated;
    });
    onThemeChange({ ...theme, contextMenuExtensions: nextExtensions });
    resetActionForm();
  };

  const addExtension = () => {
    if (editingExtensionId) {
      updateExtension();
      return;
    }
    if (!isNewActionValid()) return;
    const extensions = theme.contextMenuExtensions || [];
    const extension: ContextMenuAction = {
      id: `custom-${Date.now()}`,
      label: newActionLabel.trim(),
      enabled: true,
      actionType: newActionType,
      workingDirectory: newWorkingDirectory,
    };
    if (newActionType === 'terminal') {
      extension.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
      extension.terminalArgs = newTerminalArgs.trim();
    }
    if (newActionType === 'shell') {
      extension.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
      extension.command = newCommand.trim();
    }
    if (newActionType === 'url') {
      extension.urlTemplate = newUrlTemplate.trim();
    }
    onThemeChange({
      ...theme,
      contextMenuExtensions: [...extensions, extension],
    });
    resetActionForm();
  };

  const deleteExtension = (id: string) => {
    const extensions = theme.contextMenuExtensions || [];
    onThemeChange({
      ...theme,
      contextMenuExtensions: extensions.filter(extension => extension.id !== id),
    });
  };

  const handleDeleteExtension = async (id: string, label: string) => {
    const ok = await tauriConfirm(t('dialogs.deleteConfirm', { label }), {
      title: t('settings.extensions.deleteAction'),
      kind: 'warning',
    });
    if (!ok) return;
    deleteExtension(id);
  };

  return {
    addExtension,
    editingExtensionId,
    handleDeleteExtension,
    isNewActionValid,
    newActionLabel,
    newActionType,
    newCommand,
    newTerminalApp,
    newTerminalArgs,
    newUrlTemplate,
    newWorkingDirectory,
    populateActionForm,
    resetActionForm,
    setNewActionLabel,
    setNewActionType,
    setNewCommand,
    setNewTerminalApp,
    setNewTerminalArgs,
    setNewUrlTemplate,
    setNewWorkingDirectory,
    toggleExtension,
  };
}
