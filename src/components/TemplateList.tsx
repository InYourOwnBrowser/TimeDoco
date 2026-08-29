import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { useToast } from '../context/ToastContext';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { TimecodeSelector } from './TimecodeSelector';
import type { EntryTemplate } from '../types';
import { subMinutes } from 'date-fns';
import { checkOverlap } from '../utils/timeUtils';
import { HelpTooltip } from './ui/HelpTooltip';

export const TemplateList: React.FC = () => {
  const { settings, updateSettings, addManualEntry, timecodes, groups, entries, startTimer } = useTimeTracker();
  const { addToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EntryTemplate | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [timecodeId, setTimecodeId] = useState('');
  const [isFixedDuration, setIsFixedDuration] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [expectedDurationMinutes, setExpectedDurationMinutes] = useState('');
  const [note, setNote] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  const templates = settings?.templates || [];

  const isDirty = title !== '' || note !== '' || tagsStr !== '' || isFixedDuration || expectedDurationMinutes !== '';

  const handleOpenModal = (template?: EntryTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTitle(template.title);
      setTimecodeId(template.timecodeId);
      setIsFixedDuration(template.durationMinutes !== null);
      setDurationMinutes(template.durationMinutes || 15);
      setExpectedDurationMinutes(template.expectedDurationMinutes ? String(template.expectedDurationMinutes) : '');
      setNote(template.note);
      setTagsStr((template.tags || []).join(', '));
    } else {
      setEditingTemplate(null);
      setTitle('');
      setTimecodeId(timecodes.length > 0 ? timecodes[0].id : '');
      setIsFixedDuration(false);
      setDurationMinutes(15);
      setExpectedDurationMinutes('');
      setNote('');
      setTagsStr('');
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !timecodeId || (isFixedDuration && durationMinutes <= 0)) return;

    const finalDuration = isFixedDuration ? durationMinutes : null;
    const finalExpected = !isFixedDuration && expectedDurationMinutes
      ? Math.max(1, Number(expectedDurationMinutes))
      : null;
    const tagsArray = tagsStr.split(',').map(t => t.trim()).filter(t => t !== '').slice(0, 20);

    let newTemplates = [...templates];
    if (editingTemplate) {
      newTemplates = newTemplates.map(t =>
        t.id === editingTemplate.id
          ? { ...t, title: title.trim(), timecodeId, durationMinutes: finalDuration, expectedDurationMinutes: finalExpected, note: note.trim(), tags: tagsArray }
          : t
      );
    } else {
      newTemplates.push({
        id: crypto.randomUUID(),
        title: title.trim(),
        timecodeId,
        durationMinutes: finalDuration,
        expectedDurationMinutes: finalExpected,
        note: note.trim(),
        tags: tagsArray
      });
    }

    if (settings) {
      // Only the changed field: updateSettings re-reads the stored settings and
      // merges these keys over them, so passing the whole React snapshot would
      // reinstate every other field as this tab last saw it and undo whatever a
      // second tab changed in the meantime.
      await updateSettings({ templates: newTemplates });
      addToast(`Template ${editingTemplate ? 'updated' : 'created'}`);
      handleCloseModal();
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const templateToDelete = templates.find(t => t.id === id);
    if (!templateToDelete) return;

    if (!window.confirm(`Delete template "${templateToDelete.title}"? This can be undone from the toast for a few seconds.`)) {
      return;
    }

    const newTemplates = templates.filter(t => t.id !== id);
    if (settings) {
      await updateSettings({ templates: newTemplates });
      addToast('Template deleted', 'success', {
        label: 'Undo',
        onClick: () => {
          updateSettings({ templates: [...newTemplates, templateToDelete] });
        }
      }, 5000);
    }
  };

  const handleLogTemplate = async (template: EntryTemplate) => {
    if (template.durationMinutes == null) {
      await startTimer(template.timecodeId, template.note, template.tags, template.expectedDurationMinutes ?? null);
      addToast(`Started timer for ${template.title}`, 'success');
      return;
    }

    const end = new Date();
    const start = subMinutes(end, template.durationMinutes);

    const overlapping = checkOverlap(start, end, entries, undefined, template.timecodeId, settings?.allowConcurrentTimers);
    if (overlapping) {
      if (!window.confirm('Warning: This entry overlaps with an existing time entry. Save anyway?')) {
        return;
      }
    }

    await addManualEntry({
      timecodeId: template.timecodeId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: template.note,
      tags: template.tags
    });

    addToast(`Logged ${template.durationMinutes}m for ${template.title}`, 'success');
  };

  if (!settings) return null;

  return (
    <div className="w-full max-w-md mx-auto mt-8 mb-8">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
          Quick Log Templates
          <HelpTooltip text="One-click shortcuts. Set a fixed duration to instantly log a completed block, or leave duration off to start a live timer instead." />
        </h3>
        <button
          onClick={() => handleOpenModal()}
          className="text-xs flex items-center text-signal-dim dark:text-signal hover:underline transition-colors"
        >
          <Plus size={14} className="mr-1" /> New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400 italic">No templates created. Add one to quickly log recurring tasks (like Standup or Admin time).</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {templates.map(template => {
            const tc = timecodes.find(t => t.id === template.timecodeId);
            const tcColor = tc?.color || groups.find(g => g.id === tc?.groupId)?.color || '#94a3b8';

            return (
              <div
                key={template.id}
                className="group relative flex items-center bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-full shadow-sm hover:shadow-md hover:border-signal/50 dark:hover:border-signal/50 transition-all cursor-pointer pr-1"
                onClick={() => handleLogTemplate(template)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLogTemplate(template);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Log ${template.title}`}
              >
                <div
                  className="w-3 h-3 rounded-full ml-3 mr-2 shrink-0"
                  style={{ backgroundColor: tcColor }}
                />
                <span className="text-sm font-medium text-graphite dark:text-stone py-1.5 whitespace-nowrap">
                  {template.title} {template.durationMinutes !== null ? <span className="text-gray-600 dark:text-gray-400 font-normal text-xs ml-1">({template.durationMinutes}m)</span> : <span className="text-signal-dim dark:text-signal font-normal text-xs ml-1">▶ Start</span>}
                </span>

                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenModal(template); }}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    title="Edit template"
                    aria-label="Edit template"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, template.id)}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-rust dark:hover:text-rust rounded-full mr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust"
                    title="Delete template"
                    aria-label="Delete template"
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
        isDirty={isDirty}
      >
        <div className="bg-white dark:bg-graphite rounded-panel shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col pointer-events-auto border border-graphite/20 dark:border-white/20">
          <div className="flex justify-between items-center p-4 border-b border-graphite/20 dark:border-white/20">
            <h2 className="text-lg font-semibold text-graphite dark:text-stone">
              {editingTemplate ? "Edit Template" : "New Template"}
            </h2>
            <button type="button" onClick={handleCloseModal} className="text-gray-500 hover:text-graphite dark:text-gray-400 dark:hover:text-stone">
              <span className="sr-only">Close</span>
              ✕
            </button>
          </div>
          <div className="p-4 overflow-y-auto">
            <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Daily Standup"
              className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Timecode</label>
            <TimecodeSelector
              selectedId={timecodeId}
              onSelect={setTimecodeId}
            />
          </div>
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-graphite dark:text-stone mb-1">
              <input
                type="checkbox"
                checked={isFixedDuration}
                onChange={(e) => setIsFixedDuration(e.target.checked)}
                className="rounded border-graphite/20 dark:border-white/20 text-signal focus:ring-signal"
              />
              <span>Fixed duration</span>
            </label>
            {isFixedDuration && (
              <input
                type="number"
                min="1"
                step="1"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 mt-1 border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                required={isFixedDuration}
              />
            )}
          </div>
          {!isFixedDuration && (
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">
                Estimated time (minutes, optional)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={expectedDurationMinutes}
                onChange={(e) => setExpectedDurationMinutes(e.target.value)}
                placeholder="e.g. 30"
                className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Default note for this entry"
              className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={tagsStr}
              maxLength={500}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="e.g. design, meeting, high-priority"
              className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-graphite/20 dark:border-white/20 mt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm font-medium text-graphite dark:text-stone bg-white dark:bg-gray-800/30 border border-graphite/20 dark:border-white/20 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || !timecodeId || (isFixedDuration && durationMinutes <= 0)}
                  className="px-4 py-2 text-sm font-medium text-stone dark:text-ink bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
