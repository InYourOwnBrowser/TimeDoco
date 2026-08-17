import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { useToast } from '../context/ToastContext';
import { Edit2, Archive, ArchiveRestore, Check, X, Trash2, Merge } from 'lucide-react';
import type { Group, Timecode } from '../types';
import { HelpTooltip } from './ui/HelpTooltip';

export const GroupingManagement: React.FC = () => {
  const { groups, timecodes, addGroup, updateGroup, deleteGroup, addTimecode, updateTimecode, deleteTimecode, mergeTimecodes, settings } = useTimeTracker();
  const currencySymbol = settings?.currencySymbol || '$';
  const { addToast } = useToast();

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupData, setEditingGroupData] = useState<{ name: string; color: string }>({ name: '', color: '' });

  const [editingTimecodeId, setEditingTimecodeId] = useState<string | null>(null);
  const [editingTimecodeData, setEditingTimecodeData] = useState<{ name: string; color: string; groupId: string; hourlyRate: string }>({ name: '', color: '', groupId: '', hourlyRate: '' });

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#0a0a0a'); // graphite

  const [newTimecodeName, setNewTimecodeName] = useState('');
  const [newTimecodeColor, setNewTimecodeColor] = useState('#0a0a0a'); // graphite
  const [newTimecodeGroupId, setNewTimecodeGroupId] = useState('');
  const [newTimecodeRate, setNewTimecodeRate] = useState('');

  const [mergingTimecodeId, setMergingTimecodeId] = useState<string | null>(null);
  const [mergeDestId, setMergeDestId] = useState<string>('');


  const handleEditGroupStart = (group: Group) => {
    setEditingGroupId(group.id);
    setEditingGroupData({ name: group.name, color: group.color });
  };

  const handleEditGroupSave = async (id: string) => {
    const trimmedName = editingGroupData.name.trim();
    if (!trimmedName) return;

    if (groups.some(g => g.id !== id && g.name.toLowerCase() === trimmedName.toLowerCase())) {
      addToast('A group with this name already exists.', 'error');
      return;
    }

    await updateGroup(id, { name: trimmedName, color: editingGroupData.color });
    setEditingGroupId(null);
  };


  const handleMergeSave = async (sourceId: string) => {
    if (!mergeDestId || mergeDestId === sourceId) return;
    if (window.confirm('Are you sure you want to merge these timecodes? All entries from the source will be moved to the destination, and the source timecode will be deleted. This cannot be undone.')) {
      await mergeTimecodes(sourceId, mergeDestId);
      setMergingTimecodeId(null);
      setMergeDestId('');
    }
  };

  const handleEditTimecodeStart = (tc: Timecode) => {
    setEditingTimecodeId(tc.id);
    setEditingTimecodeData({
      name: tc.name,
      color: tc.color || '',
      groupId: tc.groupId || '',
      hourlyRate: tc.hourlyRate ? tc.hourlyRate.toString() : '',
    });
  };

  const handleEditTimecodeSave = async (id: string) => {
    const trimmedName = editingTimecodeData.name.trim();
    if (!trimmedName) return;

    if (timecodes.some(t => t.id !== id && t.name.toLowerCase() === trimmedName.toLowerCase() && (t.groupId || '') === (editingTimecodeData.groupId || ''))) {
      addToast('A timecode with this name already exists in the selected group.', 'error');
      return;
    }

    const parsedRate = parseFloat(editingTimecodeData.hourlyRate);
    await updateTimecode(id, {
      name: trimmedName,
      color: editingTimecodeData.color || undefined,
      groupId: editingTimecodeData.groupId || null,
      hourlyRate: isNaN(parsedRate) ? null : parsedRate,
    });
    setEditingTimecodeId(null);
  };

  const handleCreateGroup = async () => {
    const trimmedName = newGroupName.trim();
    if (!trimmedName) return;

    if (groups.some(g => g.name.toLowerCase() === trimmedName.toLowerCase())) {
      addToast('A group with this name already exists.', 'error');
      return;
    }

    await addGroup(trimmedName, newGroupColor);
    setNewGroupName('');
  };

  const handleCreateTimecode = async () => {
    const trimmedName = newTimecodeName.trim();
    if (!trimmedName) return;

    if (timecodes.some(t => t.name.toLowerCase() === trimmedName.toLowerCase() && (t.groupId || '') === (newTimecodeGroupId || ''))) {
      addToast('A timecode with this name already exists in the selected group.', 'error');
      return;
    }

    const parsedRate = parseFloat(newTimecodeRate);
    await addTimecode(
      trimmedName,
      newTimecodeColor,
      newTimecodeGroupId || undefined,
      isNaN(parsedRate) ? undefined : parsedRate
    );
    setNewTimecodeName('');
    setNewTimecodeRate('');
    // Leave the selected color and group in case they want to add multiple timecodes for the same group/color
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Groups Section */}
      <section className="bg-stone dark:bg-graphite p-6 rounded-panel shadow-sm border border-graphite/10 dark:border-white/10 transition-colors">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone mb-4 border-b border-graphite/10 dark:border-white/10 pb-2 flex items-center">
          Groups
          <HelpTooltip text="Timecodes are what you actually track time against (e.g. 'Client A - Design'). Groups are just a color/category used to organize timecodes." />
        </h2>

        <div className="space-y-4 mb-6">
          {groups.map(group => (
            <div key={group.id} className="flex items-center justify-between p-3 bg-stone dark:bg-graphite rounded-lg border border-graphite/10 dark:border-white/10 transition-colors">
              {editingGroupId === group.id ? (
                <div className="flex items-center gap-3 w-full">
                  <input
                    type="color"
                    value={editingGroupData.color}
                    onChange={(e) => setEditingGroupData({ ...editingGroupData, color: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
                  />
                  <input
                    type="text"
                    value={editingGroupData.color}
                    onChange={(e) => setEditingGroupData({ ...editingGroupData, color: e.target.value })}
                    className="w-20 px-2 py-1 text-sm border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal shrink-0"
                    placeholder="#HEX"
                  />
                  <input
                    type="text"
                    value={editingGroupData.name}
                    onChange={(e) => setEditingGroupData({ ...editingGroupData, name: e.target.value })}
                    className="flex-1 px-3 py-1 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-stone dark:bg-graphite text-graphite dark:text-stone"
                    autoFocus
                  />
                  <button onClick={() => handleEditGroupSave(group.id)} className="p-1 text-verdigris hover:bg-verdigris/10 transition-colors" aria-label="Save Group Edit">
                    <Check size={18} />
                  </button>
                  <button onClick={() => setEditingGroupId(null)} className="p-1 text-rust hover:bg-rust/10 transition-colors" aria-label="Cancel Group Edit">
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: group.color }}></div>
                    <span className="font-medium text-graphite dark:text-stone">{group.name}</span>
                    {group.archived && <span className="text-xs bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">Archived</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditGroupStart(group)}
                      className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-signal hover:bg-signal/10 rounded transition-colors"
                      title="Edit Group"
                      aria-label="Edit Group"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => {
                        updateGroup(group.id, { archived: !group.archived });
                      }}
                      className={`p-1.5 rounded transition-colors ${group.archived ? 'text-verdigris hover:bg-verdigris/10' : 'text-gray-400 hover:text-signal hover:bg-signal/10'}`}
                      title={group.archived ? 'Restore' : 'Archive'}
                      aria-label={group.archived ? 'Restore Group' : 'Archive Group'}
                    >
                      {group.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete "${group.name}" and all its timecodes/entries? This can be undone from the toast or Trash.`)) {
                          deleteGroup(group.id);
                        }
                      }}
                      className="p-1.5 text-gray-400 hover:text-rust hover:bg-rust/10 rounded transition-colors"
                      title="Delete Group (Move to Trash)"
                      aria-label="Delete Group"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-graphite/10 dark:border-white/10">
          <input
            type="color"
            value={newGroupColor}
            onChange={(e) => setNewGroupColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
          />
          <input
            type="text"
            value={newGroupColor}
            onChange={(e) => setNewGroupColor(e.target.value)}
            className="w-20 px-2 py-2 text-sm border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal shrink-0"
            placeholder="#HEX"
          />
          <input
            type="text"
            placeholder="New Group Name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1 px-3 py-2 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500"
          />
          <button
            onClick={handleCreateGroup}
            disabled={!newGroupName.trim()}
            className="px-4 py-2 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded text-sm font-medium disabled:opacity-50 transition-colors"
          >
            Add Group
          </button>
        </div>
      </section>

      {/* Timecodes Section */}
      <section className="bg-stone dark:bg-graphite p-6 rounded-panel shadow-sm border border-graphite/10 dark:border-white/10 transition-colors">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone mb-4 border-b border-graphite/10 dark:border-white/10 pb-2">Timecodes</h2>

        <div className="space-y-3">
          {timecodes.map(tc => {
            const group = groups.find(g => g.id === tc.groupId);
            return (
              <div key={tc.id} className="flex items-center justify-between p-3 bg-stone dark:bg-graphite rounded-lg border border-graphite/10 dark:border-white/10 transition-colors">
                {editingTimecodeId === tc.id ? (
                   <div className="flex items-center gap-3 w-full flex-wrap">
                      <input
                        type="color"
                        value={editingTimecodeData.color}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, color: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
                        title="Override Group Color"
                      />
                      <input
                        type="text"
                        value={editingTimecodeData.color}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, color: e.target.value })}
                        className="w-20 px-2 py-1 text-sm border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal shrink-0"
                        placeholder="#HEX"
                      />
                      <input
                        type="text"
                        value={editingTimecodeData.name}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, name: e.target.value })}
                        className="flex-1 min-w-[150px] px-3 py-1 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-stone dark:bg-graphite text-graphite dark:text-stone"
                        autoFocus
                      />
                      <select
                        value={editingTimecodeData.groupId}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, groupId: e.target.value })}
                        className="px-3 py-1 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
                      >
                        <option value="">No Group</option>
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1.5 text-gray-400 dark:text-gray-500">{currencySymbol}</span>
                        <input
                          type="number"
                          placeholder="Rate"
                          value={editingTimecodeData.hourlyRate}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingTimecodeData({ ...editingTimecodeData, hourlyRate: val !== '' && Number(val) < 0 ? '0' : val });
                          }}
                          className="w-24 pl-6 pr-3 py-1 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-stone dark:bg-graphite text-graphite dark:text-stone text-sm"
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <button onClick={() => handleEditTimecodeSave(tc.id)} className="p-1 text-verdigris hover:bg-verdigris/10 transition-colors" aria-label="Save Timecode Edit">
                        <Check size={18} />
                      </button>
                      <button onClick={() => setEditingTimecodeId(null)} className="p-1 text-rust hover:bg-rust/10 transition-colors" aria-label="Cancel Timecode Edit">
                        <X size={18} />
                      </button>
                   </div>

                ) : mergingTimecodeId === tc.id ? (
                  <div className="flex items-center gap-3 w-full flex-wrap">
                    <span className="font-medium text-graphite dark:text-stone">Merge "{tc.name}" into:</span>
                    <select
                      value={mergeDestId}
                      onChange={(e) => setMergeDestId(e.target.value)}
                      className="flex-1 min-w-[150px] px-3 py-1 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal bg-stone dark:bg-graphite text-graphite dark:text-stone"
                    >
                      <option value="" disabled>Select destination</option>
                      {timecodes.filter(t => t.id !== tc.id).map(t => (
                        <option key={t.id} value={t.id}>{t.name} {t.archived ? '(archived)' : ''}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleMergeSave(tc.id)}
                      disabled={!mergeDestId}
                      className="px-3 py-1.5 bg-signal hover:bg-signal-dim disabled:opacity-50 text-ink text-sm font-medium rounded transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                    >
                      Confirm Merge
                    </button>
                    <button onClick={() => { setMergingTimecodeId(null); setMergeDestId(''); }} className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors" aria-label="Cancel Merge">
                      <X size={18} />
                    </button>
                  </div>

                ) : (
                  <>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tc.color || group?.color || '#cbd5e1' }}></div>
                        <span className="font-medium text-graphite dark:text-stone">{tc.name}</span>
                        {tc.archived && <span className="text-xs bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded ml-2">Archived</span>}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-5">
                        Group: {group ? group.name : 'None'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditTimecodeStart(tc)}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-signal hover:bg-signal/10 rounded transition-colors"
                        title="Edit Timecode"
                        aria-label="Edit Timecode"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setMergingTimecodeId(tc.id);
                          setMergeDestId('');
                        }}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-signal hover:bg-signal/10 rounded transition-colors"
                        title="Merge Timecode"
                        aria-label="Merge Timecode"
                      >
                        <Merge size={16} />
                      </button>

                      <button
                        onClick={() => {
                          updateTimecode(tc.id, { archived: !tc.archived });
                        }}
                        className={`p-1.5 rounded transition-colors ${tc.archived ? 'text-verdigris hover:bg-verdigris/10' : 'text-gray-400 hover:text-signal hover:bg-signal/10'}`}
                        title={tc.archived ? 'Restore' : 'Archive'}
                        aria-label={tc.archived ? 'Restore Timecode' : 'Archive Timecode'}
                      >
                        {tc.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete "${tc.name}" and all its entries? This can be undone from the toast or Trash.`)) {
                            deleteTimecode(tc.id);
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-rust hover:bg-rust/10 rounded transition-colors"
                        title="Delete Timecode (Move to Trash)"
                        aria-label="Delete Timecode"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-graphite/10 dark:border-white/10 flex-wrap">
          <input
            type="color"
            value={newTimecodeColor}
            onChange={(e) => setNewTimecodeColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
            title="Timecode Color"
          />
          <input
            type="text"
            value={newTimecodeColor}
            onChange={(e) => setNewTimecodeColor(e.target.value)}
            className="w-20 px-2 py-2 text-sm border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-graphite text-graphite dark:text-stone outline-none focus-visible:ring-2 focus-visible:ring-signal shrink-0"
            placeholder="#HEX"
          />
          <input
            type="text"
            placeholder="New Timecode Name"
            value={newTimecodeName}
            onChange={(e) => setNewTimecodeName(e.target.value)}
            className="flex-1 min-w-[150px] px-3 py-2 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500"
          />
          <select
            value={newTimecodeGroupId}
            onChange={(e) => setNewTimecodeGroupId(e.target.value)}
            className="px-3 py-2 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
          >
            <option value="">No Group</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <div className="relative">
            <span className="absolute left-2.5 top-2.5 text-gray-400 dark:text-gray-500">{currencySymbol}</span>
            <input
              type="number"
              placeholder="Rate"
              value={newTimecodeRate}
              onChange={(e) => {
                const val = e.target.value;
                setNewTimecodeRate(val !== '' && Number(val) < 0 ? '0' : val);
              }}
              className="w-24 pl-6 pr-3 py-2 border border-graphite/10 dark:border-white/10 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500"
              min="0"
              step="0.01"
            />
          </div>
          <button
            onClick={handleCreateTimecode}
            disabled={!newTimecodeName.trim()}
            className="px-4 py-2 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded text-sm font-medium disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
          >
            Add Timecode
          </button>
        </div>
      </section>
    </div>
  );
};
