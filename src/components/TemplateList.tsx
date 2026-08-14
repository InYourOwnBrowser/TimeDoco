import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { useToast } from '../context/ToastContext';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { TimecodeSelector } from './TimecodeSelector';
import type { EntryTemplate } from '../types';
import { subMinutes } from 'date-fns';

export const TemplateList: React.FC = () => {
  const { settings, updateSettings, addManualEntry, timecodes, groups } = useTimeTracker();
  const { addToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EntryTemplate | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [timecodeId, setTimecodeId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [note, setNote] = useState('');

  const templates = settings?.templates || [];

  const handleOpenModal = (template?: EntryTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTitle(template.title);
      setTimecodeId(template.timecodeId);
      setDurationMinutes(template.durationMinutes);
      setNote(template.note);
    } else {
      setEditingTemplate(null);
      setTitle('');
      setTimecodeId(timecodes.length > 0 ? timecodes[0].id : '');
      setDurationMinutes(15);
      setNote('');
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !timecodeId || durationMinutes <= 0) return;

    let newTemplates = [...templates];
    if (editingTemplate) {
      newTemplates = newTemplates.map(t =>
        t.id === editingTemplate.id
          ? { ...t, title: title.trim(), timecodeId, durationMinutes, note: note.trim() }
          : t
      );
    } else {
      newTemplates.push({
        id: crypto.randomUUID(),
        title: title.trim(),
        timecodeId,
        durationMinutes,
        note: note.trim()
      });
    }

    if (settings) {
      await updateSettings({ ...settings, templates: newTemplates });
      addToast(`Template ${editingTemplate ? 'updated' : 'created'}`);
      handleCloseModal();
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const templateToDelete = templates.find(t => t.id === id);
    const newTemplates = templates.filter(t => t.id !== id);
    if (settings && templateToDelete) {
      await updateSettings({ ...settings, templates: newTemplates });
      addToast('Template deleted', 'success', {
        label: 'Undo',
        onClick: () => {
          updateSettings({ ...settings, templates: [...newTemplates, templateToDelete] });
        }
      }, 5000);
    }
  };

  const handleLogTemplate = async (template: EntryTemplate) => {
    const end = new Date();
    const start = subMinutes(end, template.durationMinutes);

    await addManualEntry({
      timecodeId: template.timecodeId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: template.note
    });

    addToast(`Logged ${template.durationMinutes}m for ${template.title}`, 'success');
  };

  if (!settings) return null;

  return (
    <div className="w-full mb-8">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Quick Log Templates</h3>
        <button
          onClick={() => handleOpenModal()}
          className="text-xs flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          <Plus size={14} className="mr-1" /> New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No templates created. Add one to quickly log recurring tasks (like Standup or Admin time).</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {templates.map(template => {
            const tc = timecodes.find(t => t.id === template.timecodeId);
            const tcColor = tc?.color || groups.find(g => g.id === tc?.groupId)?.color || '#94a3b8';

            return (
              <div
                key={template.id}
                className="group relative flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all cursor-pointer pr-1"
                onClick={() => handleLogTemplate(template)}
              >
                <div
                  className="w-3 h-3 rounded-full ml-3 mr-2 shrink-0"
                  style={{ backgroundColor: tcColor }}
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 py-1.5 whitespace-nowrap">
                  {template.title} <span className="text-gray-400 font-normal text-xs ml-1">({template.durationMinutes}m)</span>
                </span>

                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenModal(template); }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-full"
                    title="Edit template"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, template.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-full mr-1"
                    title="Delete template"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isModalOpen && (
      <Modal
        onClose={handleCloseModal}
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col pointer-events-auto">
          <div className="flex justify-between items-center p-4 border-b dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingTemplate ? "Edit Template" : "New Template"}
            </h2>
            <button type="button" onClick={handleCloseModal} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <span className="sr-only">Close</span>
              ✕
            </button>
          </div>
          <div className="p-4 overflow-y-auto">
            <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Daily Standup"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timecode</label>
            <TimecodeSelector
              selectedId={timecodeId}
              onSelect={setTimecodeId}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Duration (minutes)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Default note for this entry"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

              <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700 mt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || !timecodeId || durationMinutes <= 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      </Modal>
      )}
    </div>
  );
};
